// .note カスタムファイル形式 → note.com 投稿
//
// 形式:
//   ┌─ プロパティ（ヘッダー: 必須は title のみ）─────────────┐
//   title:           タイトル                          [必須]
//   status:          draft | published                 デフォルト draft
//   publish_at:      2026-04-25T16:00:00+09:00         (記録用; APIで予約投稿は未対応)
//   eyecatch:        URL or ローカルパス
//   price:           300                               (有料記事の価格)
//   toc:             true                              (目次表示)
//   description:     SEO用の概要文 (140字程度)
//   hashtags:        #ADHD, #自己開発                  (カンマ区切り or スペース区切り)
//   disable_comment: true                              (コメント無効)
//   ┌─ 本文 (---より下) ─────────────────────────────────┐
//   # h2見出し
//   ## h3見出し
//   通常段落
//   img: URL                          ← 本文画像（アップロード）
//   embed: URL                        ← SNS埋め込み (X/Threads/YouTube/Spotify)
//   - リスト
//   > 引用テキスト
//   > 出典: 出典文字列                ← 引用に出典付き
//   ```
//   code
//   ```
//   === paywall ===                  ← 有料境界
//   ... 有料本文
//
// 使い方:
//   const plan = parseNoteFile(text);                       // 解析のみ
//   await postNoteFile(client, text);                       // 下書き保存（status:draft デフォルト）
//   await postNoteFile(client, text, { publish: true });    // 強制公開
//   ※ status: published を .note に書けばオプション不要

import { createNoteRaw, saveDraft, publishNote } from "./notes.mjs";
import { uploadImage, uploadBodyImage } from "./images.mjs";
import { embedUrl } from "./embeds.mjs";
import { elements, buildPaywallBody } from "./paywall.mjs";
import { uploadSound, soundFigure, uploadAttachment, attachmentFigure } from "./sounds.mjs";

// ===== Parser =====
const PROP_KEYS = {
  number:  ["price"],
  boolean: ["toc", "disable_comment"],
  list:    ["hashtags"],   // カンマ or スペース区切り
};

export function parseNoteFile(text) {
  const [headerRaw, ...bodyParts] = text.split(/^---\s*$/m);
  if (bodyParts.length === 0) throw new Error(".note には '---' 区切りが必要");
  const bodyRaw = bodyParts.join("---").trim();

  const meta = {};
  for (const line of headerRaw.split("\n")) {
    const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)$/);
    if (!m) continue;
    const [, k, v] = m;
    const val = v.trim();
    if (!val) continue;
    if (PROP_KEYS.number.includes(k))  meta[k] = Number(val);
    else if (PROP_KEYS.boolean.includes(k)) meta[k] = /^true$/i.test(val);
    else if (PROP_KEYS.list.includes(k)) meta[k] = val.split(/[,\s]+/).filter(Boolean);
    else meta[k] = val;
  }
  if (!meta.title) throw new Error("title: が必須");

  const [freeRaw, payRaw] = splitPaywall(bodyRaw);
  return { meta, freeTokens: tokenize(freeRaw), payTokens: payRaw ? tokenize(payRaw) : null };
}

function splitPaywall(body) {
  const re = /^===\s*paywall\s*===\s*$/m;
  const m = body.match(re);
  if (!m) return [body, null];
  return [body.slice(0, m.index).trim(), body.slice(m.index + m[0].length).trim()];
}

function tokenize(text) {
  const lines = text.split("\n");
  const tokens = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) { codeLines.push(lines[i]); i++; }
      i++;
      tokens.push({ type: "code", lang, content: codeLines.join("\n") });
      continue;
    }

    if (line.startsWith(">")) {
      const qLines = [];
      while (i < lines.length && lines[i].startsWith(">")) {
        qLines.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      let source = "";
      const last = qLines[qLines.length - 1];
      const srcMatch = last?.match(/^(?:出典|src)\s*[:：]\s*(.+)$/);
      if (srcMatch) { source = srcMatch[1].trim(); qLines.pop(); }
      tokens.push({ type: "quote", text: qLines.join("<br>"), source });
      continue;
    }

    if (/^- /.test(line)) {
      const items = [];
      while (i < lines.length && /^- /.test(lines[i])) { items.push(lines[i].slice(2).trim()); i++; }
      tokens.push({ type: "list", items });
      continue;
    }

    if (/^## /.test(line)) { tokens.push({ type: "h3", text: line.slice(3).trim() }); i++; continue; }
    if (/^# /.test(line))  { tokens.push({ type: "h2", text: line.slice(2).trim() }); i++; continue; }

    const imgM = line.match(/^img\s*:\s*(.+)$/);
    if (imgM) { tokens.push({ type: "img", url: imgM[1].trim() }); i++; continue; }

    const embedM = line.match(/^embed\s*:\s*(.+)$/);
    if (embedM) { tokens.push({ type: "embed", url: embedM[1].trim() }); i++; continue; }

    // sound: <audioPath> | <coverPath> | <title> | <artistName>
    //   音源プレイヤーとして埋め込み (cover画像必須)
    const soundM = line.match(/^sound\s*:\s*(.+)$/);
    if (soundM) {
      const parts = soundM[1].split("|").map(s => s.trim());
      tokens.push({ type: "sound", audio: parts[0], cover: parts[1] || "", title: parts[2] || "", artist: parts[3] || "" });
      i++;
      continue;
    }

    // attach: <filePath>
    //   汎用ファイル添付（PDF / ZIP / mp3 raw etc）
    const attachM = line.match(/^attach\s*:\s*(.+)$/);
    if (attachM) {
      tokens.push({ type: "attach", path: attachM[1].trim() });
      i++;
      continue;
    }

    tokens.push({ type: "p", text: line });
    i++;
  }
  return tokens;
}

// ===== Executor =====
async function renderTokens(client, noteKey, tokens, e) {
  for (const t of tokens) {
    switch (t.type) {
      case "h2": e.h2(t.text); break;
      case "h3": e.h3(t.text); break;
      case "p":  e.p(t.text); break;
      case "list": e.ul(t.items); break;
      case "quote": e.blockquote(t.text, t.source); break;
      case "code":
        e.raw(`<pre name="${randId()}" id="${randId()}"><code>${escapeHtml(t.content)}</code></pre>`);
        break;
      case "img": {
        const img = await uploadBodyImage(client, t.url);
        e.figureImg(img.url, "", { width: img.width, height: img.height });
        break;
      }
      case "embed": {
        const html = await embedUrl(client, { noteKey, url: t.url });
        if (html) e.figureEmbed(html);
        else e.p(`(埋め込み失敗: ${t.url})`);
        break;
      }
      case "attach": {
        try {
          const a = await uploadAttachment(client, { noteKey, filePathOrUrl: t.path });
          const html = attachmentFigure({
            embeddedContentKey: a.embedded_content_key,
            attachmentKey: a.attachment_key,
            filename: a.filename,
          });
          e.figureEmbed(html);
        } catch (err) {
          e.p(`(attach失敗: ${err.message.slice(0,100)})`);
        }
        break;
      }
      case "sound": {
        if (!t.cover) {
          e.p(`(sound失敗: cover画像必須 ${t.audio})`);
          break;
        }
        try {
          const s = await uploadSound(client, {
            noteKey,
            audioPathOrUrl: t.audio,
            coverPathOrUrl: t.cover,
            title: t.title,
            artistName: t.artist,
          });
          const html = soundFigure({
            embeddedContentKey: s.embedded_content?.key,
            playUrl: s.play_url,
            title: s.title,
          });
          e.figureEmbed(html);
        } catch (err) {
          e.p(`(sound失敗: ${err.message.slice(0, 100)})`);
        }
        break;
      }
    }
  }
}

function randId() { return "id" + Math.random().toString(36).slice(2, 10); }
function escapeHtml(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

export async function postNoteFile(client, text, { publish: forcePublish = false } = {}) {
  const { meta, freeTokens, payTokens } = parseNoteFile(text);

  const { id: noteId, key: noteKey } = await createNoteRaw(client, { title: meta.title });

  let eyecatchKey;
  if (meta.eyecatch) {
    const ec = await uploadImage(client, noteId, meta.eyecatch);
    eyecatchKey = ec.key;
  }

  const free = elements();
  if (meta.toc) free.toc();
  await renderTokens(client, noteKey, freeTokens, free);

  // ハッシュタグは body 末尾に <p>#tag1 #tag2</p> として埋める
  // (note.com 公式の方式: 本文中の #word が自動的にタグ認識される)
  if (Array.isArray(meta.hashtags) && meta.hashtags.length > 0) {
    const tags = meta.hashtags.map(t => t.startsWith("#") ? t : "#" + t).join(" ");
    free.p(tags);
  }

  let body, separator;
  if (payTokens && payTokens.length > 0) {
    const pay = elements();
    await renderTokens(client, noteKey, payTokens, pay);
    ({ body, separator } = buildPaywallBody({ free: free.array, pay: pay.array }));
  } else {
    body = free.array.join("");
  }

  await saveDraft(client, {
    noteId, title: meta.title, body,
    eyecatchImageKey: eyecatchKey,
    index: !!meta.toc,
    separator,
    price: meta.price,
  });

  // 公開判定: forcePublish オプション or meta.status === "published"
  const shouldPublish = forcePublish || meta.status === "published";
  let publishedAt;
  if (shouldPublish) {
    await publishNote(client, {
      noteId, title: meta.title, body,
      eyecatchImageKey: eyecatchKey,
      index: !!meta.toc,
      separator,
      price: meta.price,
    });
    publishedAt = new Date().toISOString();
  }

  return {
    noteId,
    noteKey,
    status: shouldPublish ? "published" : "draft",
    editUrl: `https://editor.note.com/notes/${noteKey}/edit/`,
    publicUrl: shouldPublish ? `https://note.com/personal_dev/n/${noteKey}` : null,
    publishedAt,
    meta,
  };
}
