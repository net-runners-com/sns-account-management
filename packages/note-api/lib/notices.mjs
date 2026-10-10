// note のお知らせ API
// GET /api/v3/notices?page=N&per=12&body_ast=1
//
// 返却:
//   data: [{
//     id, kind ("like"|"follow"|"user_badge"|"comment" etc), body (HTML),
//     body_ast (parsed AST), read_flag, all_area_url, featured_area_url,
//     featured_content_name, note_name, action_users [{name, user_profile_image_path, url}],
//     noticed_at (ISO 8601)
//   }]
//   next_page, current_page
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ACCOUNTS_FILE = resolve(__dirname, "../../../accounts/accounts.json");

function getCookies(accountName) {
  if (!accountName) {
    if (process.env.NOTE_COOKIES) return process.env.NOTE_COOKIES;
    throw new Error("accountName or NOTE_COOKIES env required");
  }
  const all = JSON.parse(readFileSync(ACCOUNTS_FILE, "utf8"));
  const acc = all[accountName];
  if (!acc?.cookies) throw new Error(`account not registered or no cookies: ${accountName}`);
  return acc.cookies;
}

/**
 * notices を 1 ページ取得
 *
 * @param {object} opts
 * @param {string} [opts.accountName]
 * @param {number} [opts.page]      1-indexed (default 1)
 * @param {number} [opts.per]       1ページ件数 (default 12, **note API は実上限 20** — 超えると空応答)
 * @param {boolean} [opts.bodyAst]  body_ast 含めるか (default true)
 * @returns {Promise<{data: Array, next_page: number|null, current_page: number}>}
 */
export async function fetchNotices({ accountName, page = 1, per = 12, bodyAst = true } = {}) {
  const cookies = getCookies(accountName);
  const url = `https://note.com/api/v3/notices?page=${page}&per=${per}${bodyAst ? "&body_ast=1" : ""}`;
  const r = await fetch(url, {
    headers: {
      Accept: "*/*",
      "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
      Cookie: cookies,
      Referer: "https://note.com/",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
      "X-Requested-With": "XMLHttpRequest",
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
    },
  });
  if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/**
 * 全 notices を pagination で取得 (要注意: 数千件あると遅い)
 */
export async function fetchAllNotices({ accountName, maxPages = 10, per = 50 } = {}) {
  const all = [];
  let page = 1;
  while (page <= maxPages) {
    const r = await fetchNotices({ accountName, page, per });
    if (!r?.data?.length) break;
    all.push(...r.data);
    if (!r.next_page) break;
    page = r.next_page;
  }
  return all;
}

// notice → 簡略化 summary (UI 表示 / log 用)
export function summarize(n) {
  return {
    id: n.id,
    kind: n.kind,
    when: n.noticed_at,
    read: !!n.read_flag,
    text: stripHtml(n.body || ""),
    target_url: n.all_area_url || null,
    target_name: n.featured_content_name || n.note_name || null,
    actors: (n.action_users || []).map((u) => u.name),
    actor_urls: (n.action_users || []).map((u) => u.url),
  };
}

function stripHtml(s) {
  return String(s).replace(/<[^>]+>/g, "").trim();
}

/**
 * セッション活性化 ping (note web フロントが定期的に叩く endpoint).
 * JWT (note_gql_auth_token) を refresh + サーバ側の last_active 更新.
 */
export async function pingAuthActive({ accountName } = {}) {
  const cookies = getCookies(accountName);
  const r = await fetch("https://note.com/api/v3/auth/active", {
    headers: {
      Accept: "*/*",
      Cookie: cookies,
      Referer: "https://note.com/",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
      "X-Requested-With": "XMLHttpRequest",
    },
  });
  return { ok: r.status === 204 || r.status === 200, status: r.status };
}

const COMMON_HEADERS = {
  Accept: "*/*",
  "Content-Type": "application/json",
  "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
  Referer: "https://note.com/",
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
  "X-Requested-With": "XMLHttpRequest",
};

// 初期 fp 用のランダム 32 桁 hex (browser canvas fingerprint 等の代替). server が正規化して返す.
function randomFp() {
  let s = "";
  while (s.length < 32) s += Math.floor(Math.random() * 16).toString(16);
  return s.slice(0, 32);
}

/**
 * Step 1: POST /api/v3/trackings/fp → server 正規化 fp を取得
 */
export async function postTrackingFp({ accountName, fp } = {}) {
  const cookies = getCookies(accountName);
  const r = await fetch("https://note.com/api/v3/trackings/fp", {
    method: "POST",
    headers: { ...COMMON_HEADERS, Cookie: cookies },
    body: JSON.stringify({ fp: fp || randomFp() }),
  });
  if (r.status !== 200) return null;
  const j = await r.json().catch(() => null);
  return j?.fp || null;
}

/**
 * Step 2: POST /api/v3/trackings/visit_id → visit_id (expire 30秒) 取得
 *
 * これが note の realtime 通知配信のキー. 30 秒以内に再 ping しないと expire → server 側で
 * "ユーザー非アクティブ" 判定 → 通知の reactive 配信が止まる仮説.
 */
export async function postTrackingVisitId({ accountName, fp } = {}) {
  if (!fp) throw new Error("fp required (postTrackingFp で先に取得)");
  const cookies = getCookies(accountName);
  const r = await fetch("https://note.com/api/v3/trackings/visit_id", {
    method: "POST",
    headers: { ...COMMON_HEADERS, Cookie: cookies },
    body: JSON.stringify({ fp }),
  });
  if (r.status !== 200) return null;
  const j = await r.json().catch(() => null);
  return j ? { visit_id: j.visit_id, expire_at: j.expire_at } : null;
}

/**
 * 高レベル: アクティブセッション維持 (fp → visit_id を 1セット)
 */
export async function pingActiveSession({ accountName, cachedFp } = {}) {
  const fp = cachedFp || (await postTrackingFp({ accountName })) || null;
  if (!fp) return { ok: false, fp: null, visit: null };
  const visit = await postTrackingVisitId({ accountName, fp });
  return { ok: !!visit, fp, visit };
}
