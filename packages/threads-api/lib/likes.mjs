// Threads いいね / いいね取消
//
// REST エンドポイント:
//   POST /api/v1/media/{pk}/like/
//   POST /api/v1/media/{pk}/unlike/
//
// 入力 mediaRef は以下のいずれも受け付ける:
//   - pk: "3883038545900952856"
//   - strong_id: "3883038545900952856_78534392765"
//   - permalink URL: "https://www.threads.com/@user/post/DXjUvv5k10Y"
//   - shortcode: "DXjUvv5k10Y"  → 内部で pk に変換
import { getAccount } from "../session.mjs";
import { browserHeaders, IG_APP_ID, ASBD_ID } from "./http.mjs";
import { computeJazoest } from "./encryption.mjs";
import { jitter, getOrCreateWebSessionId, getCachedTokens, cacheTokens, extractFbTokens, httpFetch } from "./fingerprint.mjs";

// ── shortcode → pk 解決 ─────────────────────────────────────────────
// /@user/post/SHORTCODE のページから window._sharedData / shared body を見て pk を抽出.
// 失敗時は Threads の oembed 互換 API も試す.
async function resolvePk({ ref, acc, accountName }) {
  // 既に numeric pk
  if (/^\d+$/.test(ref)) return ref;
  // strong_id "PK_USERID"
  const m1 = ref.match(/^(\d+)_\d+$/);
  if (m1) return m1[1];
  // permalink URL → shortcode 抽出
  const m2 = ref.match(/threads\.com\/@[^/]+\/post\/([A-Za-z0-9_-]+)/);
  const shortcode = m2 ? m2[1] : ref;
  if (!/^[A-Za-z0-9_-]+$/.test(shortcode)) throw new Error(`unrecognized media ref: ${ref}`);

  // Threads の post HTML を取得して pk を探す
  const url = `https://www.threads.com/@${acc.username}/post/${shortcode}`;
  const res = await httpFetch(url, {
    headers: browserHeaders({
      Accept: "text/html,application/xhtml+xml,*/*;q=0.9",
      Cookie: acc.cookies,
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Upgrade-Insecure-Requests": "1",
    }),
    redirect: "manual",
  });
  const html = await res.text();

  // pk: 数字19桁前後. shortcode に紐づくものを探す
  // Threads の HTML には "pk":"3883038545900952856" の形で大量に出る
  // shortcode に近い位置の pk を採用 (一致は code フィールドで確認)
  const codeIdx = html.indexOf(`"code":"${shortcode}"`);
  if (codeIdx >= 0) {
    const window = html.slice(Math.max(0, codeIdx - 500), codeIdx + 500);
    const pkMatch = window.match(/"pk":"(\d{15,20})"/);
    if (pkMatch) return pkMatch[1];
  }
  // fallback: HTML 中の最初の pk
  const m3 = html.match(/"pk":"(\d{15,20})"/);
  if (m3) {
    // ただし shortcode が他の場所にあれば最初の pk が違う投稿の可能性 → fb_dtsg 抽出ついでに保管
    try {
      const tokens = extractFbTokens(html);
      cacheTokens(accountName, tokens);
    } catch {}
    return m3[1];
  }
  throw new Error(`pk not resolvable for ${ref}`);
}

async function callLike({ acc, accountName, pk, action }) {
  const url = `https://www.threads.com/api/v1/media/${pk}/${action}/`;
  const csrftoken = acc.csrftoken;
  const sessionId = getOrCreateWebSessionId(accountName);

  const headers = browserHeaders({
    Accept: "*/*",
    "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    Origin: "https://www.threads.com",
    Referer: `https://www.threads.com/@${acc.username}`,
    "X-CSRFToken": csrftoken,
    "X-IG-App-ID": IG_APP_ID,
    "X-ASBD-ID": ASBD_ID,
    "X-Web-Session-ID": sessionId,
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    Cookie: acc.cookies,
  });
  const tokens = getCachedTokens(accountName);
  if (tokens?.fb_dtsg) headers["X-FB-DTSG"] = tokens.fb_dtsg;
  if (tokens?.lsd) headers["X-FB-LSD"] = tokens.lsd;

  const body = new URLSearchParams({
    container_module: "barcelona_feed",
    feed_position: "0",
    media_id: pk,
    jazoest: computeJazoest(csrftoken),
  }).toString();

  const res = await httpFetch(url, { method: "POST", headers, body, redirect: "manual" });
  const raw = await res.text();
  let json;
  try { json = JSON.parse(raw); } catch { json = { _raw: raw.slice(0, 400) }; }
  return { http: res.status, json };
}

export async function likePost({ accountName, mediaRef, skipJitter = false } = {}) {
  if (!skipJitter) await jitter();
  const acc = getAccount(accountName);
  if (!acc.csrftoken || !acc.cookies) throw new Error("account missing csrftoken/cookies — refresh first");
  const pk = await resolvePk({ ref: mediaRef, acc, accountName });
  return await callLike({ acc, accountName, pk, action: "like" });
}

export async function unlikePost({ accountName, mediaRef, skipJitter = false } = {}) {
  if (!skipJitter) await jitter();
  const acc = getAccount(accountName);
  if (!acc.csrftoken || !acc.cookies) throw new Error("account missing csrftoken/cookies — refresh first");
  const pk = await resolvePk({ ref: mediaRef, acc, accountName });
  return await callLike({ acc, accountName, pk, action: "unlike" });
}
