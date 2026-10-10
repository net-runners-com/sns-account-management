// Threads セッション読み込み (standalone bundle)
// アカウント保存場所:
//   1. 環境変数 THREADS_ACCOUNTS_PATH があればそのパス (絶対 or 相対)
//   2. なければ <package>/accounts/threads_accounts.json
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ACCOUNTS_FILE = process.env.THREADS_ACCOUNTS_PATH
  ? resolve(process.env.THREADS_ACCOUNTS_PATH)
  : resolve(__dirname, "accounts/threads_accounts.json");

export function loadAccounts() {
  if (!existsSync(ACCOUNTS_FILE)) throw new Error(`accounts file not found: ${ACCOUNTS_FILE} — login_cdp.mjs でセッション取得してください`);
  return JSON.parse(readFileSync(ACCOUNTS_FILE, "utf8"));
}

export function getAccount(name) {
  const all = loadAccounts();
  const acc = all[name];
  if (!acc) {
    const known = Object.keys(all).join(", ") || "(none)";
    throw new Error(`account not registered: ${name} (known: ${known})`);
  }
  return acc;
}
