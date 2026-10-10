// Instagram アカウントセッション管理 (standalone bundle)
// アカウント保存場所:
//   1. 環境変数 INSTAGRAM_ACCOUNTS_PATH があればそのパス (絶対 or 相対)
//   2. なければ <package>/accounts/instagram_accounts.json
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ACCOUNTS_FILE = process.env.INSTAGRAM_ACCOUNTS_PATH
  ? resolve(process.env.INSTAGRAM_ACCOUNTS_PATH)
  : resolve(__dirname, "accounts/instagram_accounts.json");

export function loadAccounts() {
  if (!existsSync(ACCOUNTS_FILE)) return {};
  return JSON.parse(readFileSync(ACCOUNTS_FILE, "utf8"));
}

export function getAccount(name) {
  const all = loadAccounts();
  const acc = all[name];
  if (!acc) {
    const known = Object.keys(all).join(", ") || "(none)";
    throw new Error(`account not registered: ${name} (known: ${known}) — login_cdp.mjs か import_cdp.mjs でセッション取得してください`);
  }
  if (!acc.cookies || !acc.csrftoken) throw new Error(`account "${name}" has no cookies/csrftoken — re-run login`);
  return acc;
}
