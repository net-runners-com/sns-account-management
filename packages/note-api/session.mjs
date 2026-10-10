// note.com アカウントセッション管理 (standalone package 版)
//
// アカウント保存場所:
//   1. 環境変数 NOTE_ACCOUNTS_PATH があればそのパス (絶対 or 相対)
//   2. なければ <package>/accounts/note_accounts.json
//
// セッションキャッシュ: ./session.json (同階層)
import { NoteAPIClient } from "note-api-client";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ACCOUNTS_FILE = process.env.NOTE_ACCOUNTS_PATH
  ? resolve(process.env.NOTE_ACCOUNTS_PATH)
  : resolve(__dirname, "accounts/note_accounts.json");

const SESSION_FILE = resolve(__dirname, "session.json");

function ensureDir(filePath) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// 名前付きアカウントを accounts.json から取得して NoteAPIClient を返す
//   getClientAs("personal_dev")
// 副作用: process.env.NOTE_CLIENT_CODE をアカウントごとに上書き
export async function getClientAs(accountName) {
  if (!existsSync(ACCOUNTS_FILE)) {
    throw new Error(`note accounts file not found: ${ACCOUNTS_FILE}\nCopy accounts.example.json and fill in your account.`);
  }
  const all = JSON.parse(readFileSync(ACCOUNTS_FILE, "utf8"));
  const acc = all[accountName];
  if (!acc) throw new Error(`account not registered: ${accountName}\nAvailable: ${Object.keys(all).join(", ")}`);
  if (acc.clientCode) process.env.NOTE_CLIENT_CODE = acc.clientCode;
  const client = new NoteAPIClient(acc.cookies);
  console.log(`[session] account: ${accountName} (${acc.email})`);
  return client;
}

export function loadAccounts() {
  if (!existsSync(ACCOUNTS_FILE)) return {};
  return JSON.parse(readFileSync(ACCOUNTS_FILE, "utf8"));
}

export function saveAccounts(accounts) {
  ensureDir(ACCOUNTS_FILE);
  writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
}

export async function getClient() {
  // 0) NOTE_COOKIES env があればそれを最優先で使う（ブラウザDevToolsから取得した値）
  if (process.env.NOTE_COOKIES) {
    const client = new NoteAPIClient(process.env.NOTE_COOKIES);
    console.log("[session] using NOTE_COOKIES env");
    return client;
  }
  const client = new NoteAPIClient();
  if (existsSync(SESSION_FILE)) {
    const { cookies, csrfToken, savedAt } = JSON.parse(readFileSync(SESSION_FILE, "utf8"));
    const ageMin = (Date.now() - savedAt) / 60000;
    console.log(`[session] cached cookies, age=${ageMin.toFixed(1)}min`);
    if (ageMin < 60 * 8) {
      client.cookies = cookies;
      if (csrfToken) client.csrfToken = csrfToken;
      return client;
    }
    console.log("[session] expired, re-signing in");
  }
  const { NOTE_EMAIL, NOTE_PASSWORD } = process.env;
  if (!NOTE_EMAIL || !NOTE_PASSWORD) {
    throw new Error("NOTE_EMAIL / NOTE_PASSWORD env required for fresh sign-in");
  }
  await client.signIn({ login: NOTE_EMAIL, password: NOTE_PASSWORD, g_recaptcha_response: "", redirect_path: "/" });
  writeFileSync(SESSION_FILE, JSON.stringify({
    cookies: client.cookies,
    csrfToken: client.csrfToken,
    savedAt: Date.now(),
  }));
  console.log("[session] saved");
  return client;
}
