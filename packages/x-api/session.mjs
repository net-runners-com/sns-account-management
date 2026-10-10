// X (Twitter) アカウントセッション管理
// アカウント保存場所:
//   1. 環境変数 X_ACCOUNTS_PATH があればそのパス (絶対 or 相対)
//   2. なければ <package>/accounts/x_accounts.json
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ACCOUNTS_FILE = process.env.X_ACCOUNTS_PATH
  ? resolve(process.env.X_ACCOUNTS_PATH)
  : resolve(__dirname, "accounts/x_accounts.json");

// X web の固定 Bearer (公開値, 何年も rotate されてない)
export const X_WEB_BEARER =
  "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

export function loadAccounts() {
  if (!existsSync(ACCOUNTS_FILE)) return {};
  return JSON.parse(readFileSync(ACCOUNTS_FILE, "utf8"));
}

export function getAccount(name) {
  const all = loadAccounts();
  const acc = all[name];
  if (!acc) throw new Error(`X account not found: ${name}`);
  if (!acc.auth_token || !acc.ct0) {
    throw new Error(`X account "${name}" missing auth_token or ct0`);
  }
  return acc;
}

export function saveAccount(name, patch) {
  const all = loadAccounts();
  all[name] = { ...(all[name] || {}), ...patch };
  mkdirSync(dirname(ACCOUNTS_FILE), { recursive: true });
  writeFileSync(ACCOUNTS_FILE, JSON.stringify(all, null, 2));
}

/**
 * セッションが生きてるか確認 (UserByRestId 経由).
 * 例外を握りつぶして boolean 返す簡易版. 詳細欲しいなら check_session.mjs CLI.
 */
export async function isSessionAlive(accountName) {
  try {
    const acc = getAccount(accountName);
    const { getProfileByRestId } = await import("./lib/profile.mjs");
    const p = await getProfileByRestId(acc, { userId: acc.user_id, accountName });
    return !!p?.user_id;
  } catch {
    return false;
  }
}

// X web GraphQL / REST 呼び出し用の標準ヘッダ
export function authHeaders(acc, { json = true, referer = "https://x.com/home" } = {}) {
  const h = {
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9,ja;q=0.8",
    Authorization: X_WEB_BEARER,
    Cookie: acc.cookies,
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
    "x-csrf-token": acc.ct0,
    "x-twitter-active-user": "yes",
    "x-twitter-auth-type": "OAuth2Session",
    "x-twitter-client-language": "en",
    Origin: "https://x.com",
    Referer: referer,
  };
  if (json) h["Content-Type"] = "application/json";
  return h;
}
