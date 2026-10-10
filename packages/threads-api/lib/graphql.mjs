// Threads GraphQL 共通ヘルパ
//
// 使い方:
//   import { callGraphQL } from "./lib/graphql.mjs";
//   await callGraphQL({
//     accountName: "hiroai",
//     friendlyName: "useTHLikeMutationLikeMutation",
//     variables: { mediaID: "...", requestData: {...} },
//     referer: `https://www.threads.com/@user/post/CODE`,
//   });
//
// 内部で fb_dtsg / lsd / av を HTML から自動抽出 + jitter + tlsclient (chrome_146) で送る.
// doc_id は accounts.json の _graphql_docs から friendlyName で引く.
import { readFileSync } from "fs";
import { getAccount } from "../session.mjs";
import { ACCOUNTS_FILE } from "../session.mjs";
import { browserHeaders, IG_APP_ID, ASBD_ID } from "./http.mjs";
import { computeJazoest } from "./encryption.mjs";
import { jitter, getOrCreateWebSessionId, httpFetch } from "./fingerprint.mjs";

const GRAPHQL_URL = "https://www.threads.com/api/graphql";

// HTML を1回 fetch して fb_dtsg / lsd / av を抽出するセッションキャッシュ
const tokenCache = new Map();  // key: accountName, value: { fb_dtsg, lsd, av, fetchedAt }

async function fetchWebTokens(accountName) {
  const cached = tokenCache.get(accountName);
  if (cached && (Date.now() - cached.fetchedAt) < 10 * 60 * 1000) return cached;

  const acc = getAccount(accountName);
  const r = await httpFetch("https://www.threads.com/", {
    headers: browserHeaders({
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      Cookie: acc.cookies,
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Upgrade-Insecure-Requests": "1",
    }),
    redirect: "manual",
  });
  if (r.status !== 200) throw new Error(`web tokens fetch failed: HTTP ${r.status} (account "${accountName}" may be flagged as bot — try a different account)`);
  const html = await r.text();
  const fb_dtsg = (html.match(/"DTSGInitialData"[^{]*\{"token":"([^"]+)"/) || [])[1];
  const lsd = (html.match(/"LSD"[^{]*\{"token":"([^"]+)"/) || [])[1];
  const av = (html.match(/"actorID":"(\d+)"/) || html.match(/"USER_ID":"(\d+)"/) || [])[1];
  if (!fb_dtsg || !lsd) throw new Error(`web tokens not found in HTML (fb_dtsg=${!!fb_dtsg} lsd=${!!lsd})`);

  // 追加で web constant を HTML から抽出 (Threads が rotate しても追従)
  const __rev = (html.match(/"__rev"\s*:\s*(\d+)/) || html.match(/__rev["']?\s*[:=]\s*["']?(\d+)/) || [])[1];
  const __hs  = (html.match(/"haste_session"\s*:\s*"([^"]+)"/) || html.match(/__hs["']?\s*[:=]\s*["']([^"']+)/) || [])[1];
  const bloks = (html.match(/"bloks_version"\s*:\s*"([0-9a-f]{32,})"/) || html.match(/x-bloks-version-id["']?\s*[:=]\s*["']([0-9a-f]+)/i) || [])[1];

  const tokens = {
    fb_dtsg, lsd, av: av || "0",
    __rev: __rev || null,
    __hs: __hs || null,
    bloksVersionId: bloks || null,
    fetchedAt: Date.now(),
  };
  tokenCache.set(accountName, tokens);
  return tokens;
}

import { BUNDLED_DOC_IDS } from "./graphql_docs.mjs";

function lookupDocId(friendlyName) {
  // 優先順位: accounts.json._graphql_docs (override) → BUNDLED_DOC_IDS (同梱)
  let docs = {};
  try {
    docs = JSON.parse(readFileSync(ACCOUNTS_FILE, "utf8"))._graphql_docs || {};
  } catch {}
  const id = docs[friendlyName] || BUNDLED_DOC_IDS[friendlyName];
  if (!id) throw new Error(`doc_id unknown for "${friendlyName}". Update lib/graphql_docs.mjs (Meta が rotate した可能性)`);
  return id;
}

function randomB36(len) {
  let s = "";
  while (s.length < len) s += Math.random().toString(36).slice(2);
  return s.slice(0, len);
}

export async function callGraphQL({ accountName, friendlyName, variables, referer = "https://www.threads.com/", crn = "comet.threads.BarcelonaProfileThreadsColumnRoute", skipJitter = false, endpoint, rootFieldName = null } = {}) {
  if (!accountName) throw new Error("accountName required");
  if (!friendlyName) throw new Error("friendlyName required");

  if (!skipJitter) await jitter();
  const acc = getAccount(accountName);
  if (!acc.csrftoken || !acc.cookies) throw new Error("account missing csrftoken/cookies — refresh first");

  const tokens = await fetchWebTokens(accountName);
  const doc_id = lookupDocId(friendlyName);
  const sessionId = getOrCreateWebSessionId(accountName);

  // Threads web 完全模倣: HTML 抽出 or fallback constants
  const { THREADS_WEB_CONSTANTS } = await import("./fingerprint.mjs");
  const __rev = tokens.__rev || THREADS_WEB_CONSTANTS.X_FB_REV;
  const __hs = tokens.__hs || THREADS_WEB_CONSTANTS.X_FB_HS_BUNDLE;
  const __spin_t = String(Math.floor(Date.now() / 1000));
  const __hsi = String(Math.floor(Date.now() / 1) * 1000 + Math.floor(Math.random() * 1000));

  const body = new URLSearchParams({
    av: tokens.av,
    __user: "0",
    __a: "1",
    __req: Math.floor(Math.random() * 36 * 36).toString(36),  // base36 short id (実 web と同じ pattern)
    __hs,
    dpr: "2",
    __ccg: "EXCELLENT",
    __rev,
    __s: `${randomB36(6)}:${randomB36(6)}:${randomB36(6)}`,    // session id
    __hsi,
    __comet_req: "29",
    fb_dtsg: tokens.fb_dtsg,
    jazoest: computeJazoest(tokens.fb_dtsg),
    lsd: tokens.lsd,
    __spin_r: __rev,
    __spin_b: THREADS_WEB_CONSTANTS.X_FB_SPIN_B,
    __spin_t,
    __crn: crn,
    fb_api_caller_class: "RelayModern",
    fb_api_req_friendly_name: friendlyName,
    server_timestamps: "true",
    variables: JSON.stringify(variables || {}),
    doc_id,
  }).toString();

  const headers = browserHeaders({
    Accept: "*/*",
    "Content-Type": "application/x-www-form-urlencoded",
    Origin: "https://www.threads.com",
    Referer: referer,
    "X-CSRFToken": acc.csrftoken,
    "X-IG-App-ID": IG_APP_ID,
    "X-ASBD-ID": ASBD_ID,
    "X-Bloks-Version-Id": tokens.bloksVersionId || THREADS_WEB_CONSTANTS.X_BLOKS_VERSION_ID,
    "X-FB-Friendly-Name": friendlyName,
    "X-FB-LSD": tokens.lsd,
    "X-Web-Session-ID": sessionId,
    ...(rootFieldName ? { "X-Root-Field-Name": rootFieldName } : {}),
    Cookie: acc.cookies,
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
  });

  if (process.env.DEBUG_GRAPHQL) {
    console.error("[graphql DEBUG] full body:", body);
    console.error("[graphql DEBUG] full headers:", JSON.stringify(headers, null, 2));
  }
  const res = await httpFetch(endpoint || GRAPHQL_URL, { method: "POST", headers, body, redirect: "manual" });
  const raw = await res.text();
  let json;
  try { json = JSON.parse(raw); } catch { json = { _raw: raw.slice(0, 500) }; }
  return { http: res.status, json };
}

// 共通: pk / strong_id / shortcode / URL → numeric pk
export function normalizePk(input) {
  if (input == null) throw new Error("pk required");
  const s = String(input);
  if (/^\d+$/.test(s)) return s;
  const m1 = s.match(/^(\d+)_\d+$/);
  if (m1) return m1[1];
  const m2 = s.match(/threads\.com\/@[^/]+\/post\/([A-Za-z0-9_-]+)/);
  if (m2) throw new Error(`shortcode/URL は pk に解決できないため pk (numeric) で指定してください: ${m2[1]}`);
  throw new Error(`unrecognized media ref: ${input}`);
}
