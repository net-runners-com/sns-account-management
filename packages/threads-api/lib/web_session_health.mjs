// Threads web cookie 生死判定 + 別アカウント fallback
//
// check_session.mjs は IG mobile API (Bearer) でしか確認しないので web cookie 死を検知できない.
// web 経路 (graphql/query, /@user HTML) を使う処理 (user_search 等) では事前に web cookie 健康度を確認する.
import { loadAccounts } from "../session.mjs";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";

const _cache = new Map();

/**
 * 単一アカウントの web cookie が生きてるか判定
 * 生 = www.threads.com / が 200 を返す
 * 死 = 302 + Set-Cookie: sessionid=deleted
 */
export async function isWebCookieAlive(accountName, { force = false } = {}) {
  if (!force && _cache.has(accountName)) return _cache.get(accountName);
  const all = loadAccounts();
  const acc = all[accountName];
  if (!acc?.cookies) {
    _cache.set(accountName, false);
    return false;
  }
  try {
    const r = await fetch("https://www.threads.com/", {
      redirect: "manual",
      headers: { Cookie: acc.cookies, "User-Agent": UA },
      signal: AbortSignal.timeout(8000),
    });
    const setCookie = r.headers.get("set-cookie") || "";
    const dead = r.status >= 300 && r.status < 400 && /sessionid=deleted/i.test(setCookie);
    const alive = r.status === 200 && !dead;
    _cache.set(accountName, alive);
    return alive;
  } catch {
    _cache.set(accountName, false);
    return false;
  }
}

/**
 * web cookie が生きてるアカウント名を 1つ返す
 *
 * @param {object} opts
 * @param {string} [opts.preferred]  最初に試したいアカウント
 * @param {string[]} [opts.exclude]  除外するアカウント
 * @returns {Promise<string|null>}
 */
export async function findAliveWebAccount({ preferred, exclude = [] } = {}) {
  const all = loadAccounts();
  const ex = new Set(exclude);
  const order = [];
  if (preferred && !ex.has(preferred)) order.push(preferred);
  for (const name of Object.keys(all)) {
    if (name.startsWith("_")) continue;
    if (ex.has(name) || order.includes(name)) continue;
    order.push(name);
  }
  for (const name of order) {
    if (await isWebCookieAlive(name)) return name;
  }
  return null;
}
