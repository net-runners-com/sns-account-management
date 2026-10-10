// Threads / Instagram 共通 HTTP ヘルパ
// Chrome 147 完全互換ヘッダ + fb_dtsg / lsd 添付対応
import { CHROME_147_HEADERS, getOrCreateWebSessionId } from "./fingerprint.mjs";

export const UA = CHROME_147_HEADERS["User-Agent"];

export const IG_APP_ID = "238260118697367";
export const ASBD_ID = "359341";

export function browserHeaders(extra = {}) {
  return {
    ...CHROME_147_HEADERS,
    ...extra,
  };
}

export function ajaxHeaders({ csrftoken, cookie, sessionId, fb_dtsg, lsd }) {
  const h = browserHeaders({
    Accept: "*/*",
    "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    Origin: "https://www.threads.com",
    Referer: "https://www.threads.com/login",
    "X-CSRFToken": csrftoken,
    "X-IG-App-ID": IG_APP_ID,
    "X-ASBD-ID": ASBD_ID,
    "X-Instagram-AJAX": "0",
    "X-Web-Session-ID": sessionId || getOrCreateWebSessionId("__default__"),
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    Cookie: cookie,
  });
  if (fb_dtsg) h["X-FB-DTSG"] = fb_dtsg;
  if (lsd) h["X-FB-LSD"] = lsd;
  return h;
}

export function authedJsonHeaders({ csrftoken, cookie, fb_dtsg, lsd }) {
  const h = browserHeaders({
    Accept: "*/*",
    "X-CSRFToken": csrftoken,
    "X-IG-App-ID": IG_APP_ID,
    "X-ASBD-ID": ASBD_ID,
    Cookie: cookie,
  });
  if (fb_dtsg) h["X-FB-DTSG"] = fb_dtsg;
  if (lsd) h["X-FB-LSD"] = lsd;
  return h;
}

// 後方互換: 古い import で randomWebSessionId を使ってる箇所のため残す
export function randomWebSessionId() {
  return getOrCreateWebSessionId("__legacy__");
}

export function pickEncryptionMeta(headers) {
  return {
    pubKeyHex: headers.get("ig-set-password-encryption-web-pub-key"),
    keyId: headers.get("ig-set-password-encryption-web-key-id"),
    keyVersion: headers.get("ig-set-password-encryption-web-key-version"),
  };
}
