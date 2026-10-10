// フィンガープリント対策ヘルパ
//
// Node の fetch では JA3/JA4 (TLS) と HTTP/2 SETTINGS は Node 固有値で送られるため
// 完全な Chrome 模倣は不可能（Layer 1-2）. test.txt 参照.
//
// このモジュールでカバーする層:
//   Layer 3: fb_dtsg / lsd (HTML scrape & cache)
//   Layer 4: ヘッダ完全一致 (Chrome 147 互換)
//   Layer 5: デバイスID永続 / web_session_id 一貫性
//   Layer 7: ジッタ / レート制御
//
// Layer 1-2 が必要な場合は @bogdanfinn/node-tls-client などの fetch 置換を導入し
// httpFetch() を差し替える形で接続できるよう抽象化してある.
import { setTimeout as sleep } from "timers/promises";

// ── Chrome 147 / macOS 26 の完全ヘッダセット ─────────────────────────
// キャプチャ済みリクエストから抽出. これを browserHeaders 系に常時マージする
export const CHROME_147_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
  "sec-ch-ua": '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
  "sec-ch-ua-full-version-list": '"Google Chrome";v="147.0.7727.56", "Not.A/Brand";v="8.0.0.0", "Chromium";v="147.0.7727.56"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-model": '""',
  "sec-ch-ua-platform": '"macOS"',
  "sec-ch-ua-platform-version": '"26.1.0"',
  "sec-ch-prefers-color-scheme": "light",
  "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
  "Accept-Encoding": "gzip, deflate, br, zstd",
  "DPR": "2",                          // device pixel ratio (Retina Mac)
  "Priority": "u=1, i",                // HTTP/2 priority (browser sends)
  "Viewport-Width": "1280",
};

// Threads web で内部使用される定数. キャプチャから抽出した値.
// 数週おきに rotate される可能性あり.
export const THREADS_WEB_CONSTANTS = {
  X_BLOKS_VERSION_ID: "5e29fadab42cb8e08e4a4cb1dfad0df9d86c8aac9c5120ea02ed1380fad4621f",
  X_ASBD_ID: "359341",
  X_IG_APP_ID: "238260118697367",
  X_FB_HS_BUNDLE: "20569.HYP:barcelona_web_pkg.2.1...0",  // __hs
  X_FB_REV: "1038171368",                                  // __rev (Threads bundle rev)
  X_FB_SPIN_B: "trunk",                                    // __spin_b
};

// ── ジッタ: 連続リクエスト間にランダム遅延 ───────────────────────────
let lastRequestAt = 0;
export async function jitter({ minMs = 800, maxMs = 2400, perSessionMinGap = 600 } = {}) {
  const now = Date.now();
  const since = now - lastRequestAt;
  if (since < perSessionMinGap) await sleep(perSessionMinGap - since);
  const wait = minMs + Math.floor(Math.random() * (maxMs - minMs));
  await sleep(wait);
  lastRequestAt = Date.now();
}

// ── HTML から fb_dtsg / lsd を抽出 ───────────────────────────────────
// Threads 系のホーム HTML には DTSGInitialData / LSD として埋まっている
export function extractFbTokens(html) {
  const out = { fb_dtsg: null, lsd: null, jazoest: null };
  // パターン: "DTSGInitialData",[],{"token":"..."}
  const m1 = html.match(/"DTSGInitialData"[^{]*\{"token":"([^"]+)"/);
  if (m1) out.fb_dtsg = m1[1];
  // パターン: "LSD",[],{"token":"..."}
  const m2 = html.match(/"LSD"[^{]*\{"token":"([^"]+)"/);
  if (m2) out.lsd = m2[1];
  // jazoest はクライアント計算なので不要だが念のため
  const m3 = html.match(/jazoest=(\d+)/);
  if (m3) out.jazoest = m3[1];
  return out;
}

// ── トークンキャッシュ (sessionStorage 模倣) ─────────────────────────
const tokenCache = new Map();
export function cacheTokens(accountName, tokens) {
  const prev = tokenCache.get(accountName) || {};
  tokenCache.set(accountName, { ...prev, ...tokens, cachedAt: Date.now() });
}
export function getCachedTokens(accountName, { maxAgeMin = 30 } = {}) {
  const t = tokenCache.get(accountName);
  if (!t) return null;
  if ((Date.now() - t.cachedAt) / 60000 > maxAgeMin) return null;
  return t;
}

// ── web_session_id: セッション内で一貫値を使う (毎リクエストで変えない) ─
const sessionIdCache = new Map();
export function getOrCreateWebSessionId(accountName) {
  if (sessionIdCache.has(accountName)) return sessionIdCache.get(accountName);
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const seg = (n) => Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  const id = `${seg(6)}:${seg(6)}:${seg(6)}`;
  sessionIdCache.set(accountName, id);
  return id;
}

// ── HTTP 抽象化: TLS 模倣 fetch (Tier 2) ─────────────────────────────
// tlsclientwrapper (bogdanfinn/tls-client) で Chrome 146 の JA3/JA4 + HTTP/2
// SETTINGS フレームを模倣する. 環境変数 THREADS_PLAIN_FETCH=1 で従来の Node
// fetch (Tier 1 のみ) に戻せる
import { tlsFetch } from "./tls_fetch.mjs";
export const httpFetch = process.env.THREADS_PLAIN_FETCH ? globalThis.fetch : tlsFetch;
