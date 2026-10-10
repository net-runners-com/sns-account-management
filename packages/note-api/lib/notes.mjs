// 記事の作成・下書き保存
// ライブラリの createNote / saveDraft より高機能（eyecatch / 有料エリア separator まで一発）

import { authHeaders } from "./auth.mjs";

export async function createNoteRaw(client, { title = "", body = "" } = {}) {
  const res = await fetch("https://note.com/api/v1/text_notes", {
    method: "POST",
    headers: authHeaders(client),
    body: JSON.stringify({ name: title, body, template_key: null }),
  });
  if (!res.ok) throw new Error(`createNote failed ${res.status}: ${await res.text()}`);
  return (await res.json()).data;
}

// 全機能入り下書き保存
// options:
//   noteId         : number | string  (必須)
//   title          : string            (必須)
//   body           : string HTML       (必須)
//   index          : boolean           目次有効化
//   eyecatchImageKey : string          アイキャッチの画像key
//   separator      : string UUID       有料境界要素のUUID (paywall.mjs の helper参照)
//   price          : number            価格(円)
//   pictures       : Array             本文画像のメタ [{key, url, alt?, caption?, width?, height?}]
//                                      uploadBodyImage の返り値を配列にして渡す
export async function saveDraft(client, { noteId, title, body, eyecatchImageKey, index = false, separator, price, pictures }) {
  const url = `https://note.com/api/v1/text_notes/draft_save?id=${noteId}&is_temp_saved=true`;
  const payload = {
    name: title,
    body,
    body_length: body.replace(/<[^>]*>/g, "").length,
    index,
    is_lead_form: false,
  };
  if (eyecatchImageKey) payload.eyecatch_image_key = eyecatchImageKey;
  if (separator) payload.separator = separator;
  if (price !== undefined) payload.price = price;
  // pictures は draft_save に送っても無視される（auto計算）ので何もしない
  // uploadBodyImage でS3に置けば、body内のimgタグから note.com 側が自動で pictures を復元する
  const res = await fetch(url, {
    method: "POST",
    headers: authHeaders(client),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`saveDraft failed ${res.status}: ${await res.text()}`);
  return res.json();
}

// コメント投稿: POST /api/v3/notes/<noteKey>/note_comments
//   message:    コメント本文 (改行=\nで段落分け)
//   parentKey:  返信先のコメントkey (省略すれば通常のコメント)
//   ⚠️ 対象記事のコメントが無効化されてると 403
export async function postComment(client, { noteKey, message, parentKey }) {
  const paragraphs = message.split("\n").filter(l => l.length > 0);
  const comment = {
    type: "root",
    children: paragraphs.map(text => ({
      type: "element",
      tag_name: "p",
      children: [{ type: "text", value: text }],
    })),
  };
  const payload = { comment, acknowledgement: false };
  if (parentKey) payload.parent_key = parentKey;
  const res = await fetch(`https://note.com/api/v3/notes/${noteKey}/note_comments`, {
    method: "POST",
    headers: authHeaders(client, { referer: `https://note.com/personal_dev/n/${noteKey}`, origin: "https://note.com" }),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`postComment failed ${res.status}: ${await res.text()}`);
  return res.json();
}

// 返信コメント投稿のエイリアス（明示的に分けたい人向け）
export async function replyComment(client, { noteKey, parentKey, message }) {
  return postComment(client, { noteKey, message, parentKey });
}

// 記事にスキ（いいね）: POST /api/v3/notes/<noteKey>/likes
export async function likeNote(client, { noteKey }) {
  const res = await fetch(`https://note.com/api/v3/notes/${noteKey}/likes`, {
    method: "POST",
    headers: authHeaders(client, { referer: `https://note.com/personal_dev/n/${noteKey}`, origin: "https://note.com" }),
  });
  if (!res.ok) throw new Error(`likeNote failed ${res.status}: ${await res.text()}`);
  return res.json().catch(() => ({ ok: true }));
}

// 記事のスキ解除: DELETE /api/v3/notes/<noteKey>/likes
export async function unlikeNote(client, { noteKey }) {
  const res = await fetch(`https://note.com/api/v3/notes/${noteKey}/likes`, {
    method: "DELETE",
    headers: authHeaders(client, { referer: `https://note.com/personal_dev/n/${noteKey}`, origin: "https://note.com" }),
  });
  if (!res.ok) throw new Error(`unlikeNote failed ${res.status}: ${await res.text()}`);
  return res.json().catch(() => ({ ok: true }));
}

// コメント一覧取得: GET /api/v3/notes/<noteKey>/note_comments
//   返り値: コメント配列 [{ key, comment, like_count, reply_count, is_edited, created_at, user, ... }]
//   各 comment は AST 形式 → 取り出しヘルパで plain text 化
export async function getCommentList(client, { noteKey }) {
  const res = await fetch(`https://note.com/api/v3/notes/${noteKey}/note_comments`, {
    headers: authHeaders(client, { referer: `https://note.com/personal_dev/n/${noteKey}`, origin: "https://note.com" }),
  });
  if (!res.ok) throw new Error(`getCommentList failed ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const data = json?.data;
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") return Object.values(data);
  return [];
}

// コメントAST → plain text（段落 \n 連結）
export function commentToText(comment) {
  if (!comment) return "";
  const root = comment.comment || comment;
  const ps = root?.children || [];
  return ps.map(p => (p.children || []).map(t => t.value || "").join("")).join("\n");
}

// コメント編集: PUT /api/v3/notes/<noteKey>/note_comments/<commentKey>
//   payload は postComment と同じ AST 形式 ({comment: {...}})
export async function editComment(client, { noteKey, commentKey, message }) {
  const paragraphs = message.split("\n").filter(l => l.length > 0);
  const comment = {
    type: "root",
    children: paragraphs.map(text => ({
      type: "element",
      tag_name: "p",
      children: [{ type: "text", value: text }],
    })),
  };
  const res = await fetch(`https://note.com/api/v3/notes/${noteKey}/note_comments/${commentKey}`, {
    method: "PUT",
    headers: authHeaders(client, { referer: `https://note.com/personal_dev/n/${noteKey}`, origin: "https://note.com" }),
    body: JSON.stringify({ comment }),
  });
  if (!res.ok) throw new Error(`editComment failed ${res.status}: ${await res.text()}`);
  return res.json();
}

// コメント削除: DELETE /api/v3/notes/<noteKey>/note_comments/<commentKey>
export async function deleteComment(client, { noteKey, commentKey }) {
  const res = await fetch(`https://note.com/api/v3/notes/${noteKey}/note_comments/${commentKey}`, {
    method: "DELETE",
    headers: authHeaders(client, { referer: `https://note.com/personal_dev/n/${noteKey}`, origin: "https://note.com" }),
  });
  if (!res.ok) throw new Error(`deleteComment failed ${res.status}: ${await res.text()}`);
  return { ok: true };
}

// コメントにいいね: POST /api/v3/notes/<noteKey>/note_comments/<commentKey>/likes
export async function likeComment(client, { noteKey, commentKey }) {
  const res = await fetch(`https://note.com/api/v3/notes/${noteKey}/note_comments/${commentKey}/likes`, {
    method: "POST",
    headers: authHeaders(client, { referer: `https://note.com/personal_dev/n/${noteKey}`, origin: "https://note.com" }),
  });
  if (!res.ok) throw new Error(`likeComment failed ${res.status}: ${await res.text()}`);
  return res.json();
}

// コメントいいね解除: DELETE /api/v3/notes/<noteKey>/note_comments/<commentKey>/likes
export async function unlikeComment(client, { noteKey, commentKey }) {
  const res = await fetch(`https://note.com/api/v3/notes/${noteKey}/note_comments/${commentKey}/likes`, {
    method: "DELETE",
    headers: authHeaders(client, { referer: `https://note.com/personal_dev/n/${noteKey}`, origin: "https://note.com" }),
  });
  if (!res.ok) throw new Error(`unlikeComment failed ${res.status}: ${await res.text()}`);
  return res.json().catch(() => ({ ok: true }));
}

// 削除: 公開済記事を削除 (DELETE /api/v1/notes/<id>)
//   ⚠️ 不可逆操作。確認してから呼ぶこと。
export async function deleteNote(client, { noteId }) {
  const res = await fetch(`https://note.com/api/v1/notes/${noteId}`, {
    method: "DELETE",
    headers: authHeaders(client),
  });
  if (!res.ok) throw new Error(`deleteNote failed ${res.status}: ${await res.text()}`);
  return res.json().catch(() => ({ ok: true }));
}

// 下書き削除: 未公開の下書きを削除 (DELETE /api/v1/text_notes/draft_delete?id=<id>)
//   一括掃除に便利。テスト用 [TEST...] みたいな下書きを定期削除する用途。
export async function deleteDraft(client, { noteId }) {
  const res = await fetch(`https://note.com/api/v1/text_notes/draft_delete?id=${noteId}`, {
    method: "DELETE",
    headers: authHeaders(client),
    body: JSON.stringify({ id: noteId }),
  });
  if (!res.ok) throw new Error(`deleteDraft failed ${res.status}: ${await res.text()}`);
  return res.json().catch(() => ({ ok: true }));
}

// 公開: PUT /api/v1/text_notes/<id>  status="published"
//   draft で saveDraft 済の noteId に対して呼ぶ。
//   ⚠️ 実行すると即座に公開されるので注意。
export async function publishNote(client, { noteId, title, body, eyecatchImageKey, index = false, separator, price }) {
  const url = `https://note.com/api/v1/text_notes/${noteId}`;
  const payload = {
    status: "published",
    name: title,
    free_body: body,
    eyecatch_image_key: eyecatchImageKey || null,
    index,
  };
  if (separator) payload.separator = separator;
  if (price !== undefined) payload.price = price;
  const res = await fetch(url, {
    method: "PUT",
    headers: authHeaders(client),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`publishNote failed ${res.status}: ${await res.text()}`);
  return res.json();
}
