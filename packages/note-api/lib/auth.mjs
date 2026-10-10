// 認証ヘッダ生成
// Cookie + x-note-client-code + UA をひとまとめにする。生APIを叩くときに全部これを使う。

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";

// 動作確認済の構成: origin=note.com, referer=note.com/notes/new
// editor.note.com 指定は GET /embed_by_external_api のみで必要
export function authHeaders(client, { json = true, referer = "https://note.com/notes/new", origin = "https://note.com" } = {}) {
  const h = {
    Accept: "application/json, text/plain, */*",
    Cookie: client.cookies,
    "User-Agent": UA,
    Origin: origin,
    Referer: referer,
    "x-requested-with": "XMLHttpRequest",
  };
  if (json) h["Content-Type"] = "application/json";
  if (process.env.NOTE_CLIENT_CODE) h["x-note-client-code"] = process.env.NOTE_CLIENT_CODE;
  return h;
}
