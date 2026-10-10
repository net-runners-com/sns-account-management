// 音源アップロード（3ステップ）
//   1. POST /api/v3/sounds/presigned_posts → S3 PUT URL 取得
//   2. PUT to S3 で音声本体アップロード
//   3. POST /api/v3/sounds (multipart) で記事に紐付けて登録
//
// レスポンスの embedded_content.key を embedFigure 経由で body に挿入する

import { authHeaders } from "./auth.mjs";

export async function uploadSound(client, {
  noteKey,                  // 紐付け先記事のkey
  audioPathOrUrl,           // ローカルパス or URL
  coverPathOrUrl,           // カバー画像（必須）
  title = "",
  artistName = "",
  filename = "audio.mp3",
  contentType = "audio/mpeg",
  downloadable = true,
}) {
  // ファイル取得
  let audioBuf, coverBuf, autoFilename = filename;
  if (/^https?:\/\//.test(audioPathOrUrl)) {
    audioBuf = Buffer.from(await (await fetch(audioPathOrUrl)).arrayBuffer());
  } else {
    const { readFileSync } = await import("fs");
    audioBuf = readFileSync(audioPathOrUrl);
    autoFilename = audioPathOrUrl.split("/").pop() || filename;
  }
  if (/^https?:\/\//.test(coverPathOrUrl)) {
    coverBuf = Buffer.from(await (await fetch(coverPathOrUrl)).arrayBuffer());
  } else {
    const { readFileSync } = await import("fs");
    coverBuf = readFileSync(coverPathOrUrl);
  }
  const coverMime = detectMime(coverBuf);

  // Step 1: presigned_posts
  const r1 = await fetch("https://note.com/api/v3/sounds/presigned_posts", {
    method: "POST",
    headers: authHeaders(client, { referer: "https://editor.note.com/", origin: "https://editor.note.com" }),
    body: JSON.stringify({ filename: autoFilename, content_type: contentType, size: audioBuf.length }),
  });
  if (!r1.ok) throw new Error(`presigned_posts failed ${r1.status}: ${await r1.text()}`);
  const { upload_key, upload_url } = (await r1.json()).data;

  // Step 2: PUT to S3
  const r2 = await fetch(upload_url, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: audioBuf,
  });
  if (r2.status < 200 || r2.status >= 300) throw new Error(`S3 PUT failed ${r2.status}`);

  // Step 3: register
  const form = new FormData();
  form.append("note_key", noteKey);
  form.append("upload_key", upload_key);
  form.append("filename", autoFilename);
  form.append("title", title || autoFilename);
  form.append("artist_name", artistName);
  form.append("downloadable", String(downloadable));
  form.append("image_file", new Blob([coverBuf], { type: coverMime }), "cover" + (coverMime === "image/png" ? ".png" : ".jpg"));

  const r3 = await fetch("https://note.com/api/v3/sounds", {
    method: "POST",
    body: form,
    headers: authHeaders(client, { json: false, referer: "https://editor.note.com/", origin: "https://editor.note.com" }),
  });
  if (!r3.ok) throw new Error(`sounds register failed ${r3.status}: ${await r3.text()}`);
  return (await r3.json()).data;
}

// 音源の figure HTML を生成（body 埋め込み用）
import crypto from "crypto";
export function soundFigure({ embeddedContentKey, playUrl, title = "" }) {
  const id = crypto.randomUUID();
  return `<figure name="${id}" id="${id}" data-src="${playUrl}" embedded-service="sound" embedded-content-key="${embeddedContentKey}"><a href="${playUrl}" rel="nofollow noopener">${title}</a></figure>`;
}

// 添付ファイル figure HTML 生成 (embed系と同じ figure構造)
export function attachmentFigure({ embeddedContentKey, attachmentKey, filename }) {
  const id = crypto.randomUUID();
  return `<figure name="${id}" id="${id}" data-attachment-key="${attachmentKey}" embedded-service="attachment" embedded-content-key="${embeddedContentKey}"><a href="https://note.com/api/v2/attachments/download/${attachmentKey}" rel="nofollow noopener">${filename}</a></figure>`;
}

// 汎用ファイル添付: POST /api/v2/attachments/upload
//   note.com の本文に「📎 ファイル添付」として埋まる（PDF / ZIP / 音源 raw 等）
//   音源プレイヤー(uploadSound)とは別物
export async function uploadAttachment(client, { noteKey, filePathOrUrl, fileName }) {
  let buf, autoName = fileName;
  if (/^https?:\/\//.test(filePathOrUrl)) {
    buf = Buffer.from(await (await fetch(filePathOrUrl)).arrayBuffer());
  } else {
    const { readFileSync } = await import("fs");
    buf = readFileSync(filePathOrUrl);
    autoName = autoName || filePathOrUrl.split("/").pop();
  }
  const form = new FormData();
  form.append("file", new Blob([buf]), autoName);
  form.append("file_name", autoName);
  form.append("note_key", noteKey);
  const res = await fetch("https://note.com/api/v2/attachments/upload", {
    method: "POST",
    body: form,
    headers: authHeaders(client, { json: false, referer: "https://editor.note.com/", origin: "https://editor.note.com" }),
  });
  if (!res.ok) throw new Error(`uploadAttachment failed ${res.status}: ${await res.text()}`);
  return (await res.json()).data;
}

function detectMime(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf[0] === 0x47 && buf[1] === 0x49) return "image/gif";
  if (buf[0] === 0x52 && buf[1] === 0x49) return "image/webp";
  return "image/jpeg";
}
