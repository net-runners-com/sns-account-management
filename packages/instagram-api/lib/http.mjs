// Instagram private web API (i/www.instagram.com/api/v1) を叩く fetch ラッパー
//
// RE 実証済みの最小認証レシピ:
//   Cookie:  sessionid / csrftoken / ds_user_id / ...  (ブラウザ吸い出し)
//   Header:  X-IG-App-ID, X-CSRFToken(=csrftoken), X-ASBD-ID, X-Requested-With
//   ※ X-IG-WWW-Claim は不要だった (none でも 200)
//
// 動作確認: web_profile_info / feed/timeline / feed/reels_tray / direct_v2/inbox = 200
import { getAccount } from "../session.mjs";

export const IG_APP_ID = "936619743392459"; // web 共通 App-ID
const BASE = "https://www.instagram.com";

// 実ブラウザに近い UA (一部 endpoint は UA 厳格なので合わせておく)
const WEB_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";

export function buildHeaders(acc, extra = {}) {
  return {
    "X-IG-App-ID": IG_APP_ID,
    "X-CSRFToken": acc.csrftoken,
    "X-ASBD-ID": "129477",
    "X-Requested-With": "XMLHttpRequest",
    "X-IG-WWW-Claim": "0",
    "User-Agent": WEB_UA,
    "Referer": BASE + "/",
    "Cookie": acc.cookies,
    ...extra,
  };
}

// path は "/api/v1/..." または絶対 URL。method GET/POST。bodyObj は POST の form。
export async function igFetch(accountName, path, { method = "GET", body = null, headers = {} } = {}) {
  const acc = getAccount(accountName);
  const url = path.startsWith("http") ? path : BASE + path;
  const init = { method, headers: buildHeaders(acc, headers), redirect: "manual" };
  if (body != null) {
    init.headers["Content-Type"] = "application/x-www-form-urlencoded";
    init.body = typeof body === "string" ? body
      : Object.entries(body).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  }
  const r = await fetch(url, init);
  const ct = r.headers.get("content-type") || "";
  const text = await r.text();
  let json = null;
  if (ct.includes("json")) { try { json = JSON.parse(text); } catch {} }
  if (r.status === 302 || (json && json.message === "login_required")) {
    throw new Error(`auth expired (status ${r.status}) — re-run ig_import_browser_session.mjs for "${accountName}"`);
  }
  if (!r.ok && !json) throw new Error(`HTTP ${r.status} ${path}: ${text.slice(0, 200)}`);
  return { status: r.status, json, text, headers: r.headers };
}
