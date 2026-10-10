// CloakBrowser で note.com に対話ログインして cookie / client-code を取得する。
// note は signin API が reCAPTCHA 必須になったため programmatic signIn は不可。
// 代わりに stealth ブラウザを開いてユーザーが手動ログイン (reCAPTCHA 解決) し、
// ログイン後の _note_session_v5 cookie と x-note-client-code ヘッダを抽出して保存する。
//
// ログイン完了の通知は signal file ハンドシェイク方式:
//   1. このスクリプトはブラウザを開いて signal file が出現するまで待つ
//   2. ユーザーがブラウザでログイン (reCAPTCHA も手動で解決)
//   3. ユーザーが claude code に「ログインできた」と伝える
//   4. claude code が `touch <signalFile>` を実行
//   5. このスクリプトが signal を検出して cookie / client-code を抽出 → 保存
//
// programmatic 使用例:
//   import { browserLogin } from "./lib/browser_login.mjs";
//   const record = await browserLogin({ accountName: "personal_dev" });

import { existsSync, unlinkSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// session.mjs と同じ解決ルール: NOTE_ACCOUNTS_PATH > <package>/accounts/note_accounts.json
export const ACCOUNTS_FILE = process.env.NOTE_ACCOUNTS_PATH
  ? resolve(process.env.NOTE_ACCOUNTS_PATH)
  : resolve(__dirname, "..", "accounts", "note_accounts.json");

export function defaultSignalFile(accountName) {
  return `/tmp/note_login_${accountName}.ready`;
}

// note が必要とする cookie。_note_session_v5 が認証本体、他は web 同等に送るための補助。
const COOKIE_NAMES = [
  "_note_session_v5",
  "fp",
  "XSRF-TOKEN",
  "_vid_v1",
  "_vid_v2",
  "_gid",
  "_ga",
];

function buildCookieString(byName) {
  const parts = [];
  for (const k of COOKIE_NAMES) {
    if (byName[k]) parts.push(`${k}=${byName[k]}`);
  }
  // 上記以外の _ga_* (GA4 stream) も拾う
  for (const [k, v] of Object.entries(byName)) {
    if (k.startsWith("_ga_") && !COOKIE_NAMES.includes(k)) parts.push(`${k}=${v}`);
  }
  return parts.join("; ");
}

function loadAccounts() {
  if (!existsSync(ACCOUNTS_FILE)) return {};
  return JSON.parse(readFileSync(ACCOUNTS_FILE, "utf8"));
}

function saveAccounts(accounts) {
  const dir = dirname(ACCOUNTS_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (existsSync(ACCOUNTS_FILE)) copyFileSync(ACCOUNTS_FILE, ACCOUNTS_FILE + ".bak");
  writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2) + "\n");
}

/**
 * @param {Object} opts
 * @param {string} opts.accountName  保存先アカウント名 (accounts/note_accounts.json のキー)
 * @param {string} [opts.signalFile]  ログイン完了を通知するファイルパス. デフォルト: /tmp/note_login_<account>.ready
 * @param {number} [opts.timeoutSec=600]  signal 待ち最大秒 (reCAPTCHA を解く余裕を持たせる)
 * @param {boolean} [opts.headless=false]  ヘッドレス起動 (対話ログインには false)
 * @param {boolean} [opts.persist=true]  accounts/note_accounts.json に保存するか
 * @param {(msg:string)=>void} [opts.log=console.error]  進捗ログ出力
 * @returns {Promise<{email?:string, cookies:string, clientCode:string, refreshedAt:string, refreshedVia:string}>}
 */
export async function browserLogin({
  accountName,
  signalFile,
  timeoutSec = 600,
  headless = false,
  persist = true,
  log = console.error,
} = {}) {
  if (!accountName) throw new Error("accountName is required");
  const signal = signalFile || defaultSignalFile(accountName);

  // stale signal を掃除
  try { unlinkSync(signal); } catch {}

  const { launch } = await import("cloakbrowser");

  log(`[login] launching CloakBrowser (headless=${headless})...`);
  const browser = await launch({
    headless,
    humanize: true,
    locale: "ja-JP",
    timezone: "Asia/Tokyo",
  });

  // note API リクエストから x-note-client-code を捕獲する
  let capturedClientCode = "";
  function watchPage(page) {
    page.on("request", (req) => {
      try {
        const cc = req.headers()["x-note-client-code"];
        if (cc && !capturedClientCode) {
          capturedClientCode = cc;
          log(`[login] captured x-note-client-code: ${cc.slice(0, 12)}...`);
        }
      } catch {}
    });
  }

  try {
    const ctx = browser.contexts()[0] || (await browser.newContext());
    ctx.on("page", watchPage);
    const page = await ctx.newPage();
    watchPage(page);

    log(`[login] navigating to https://note.com/login`);
    await page.goto("https://note.com/login", { waitUntil: "domcontentloaded" });

    log("");
    log("==========================================");
    log("  ブラウザで note にログインしてください。");
    log("  reCAPTCHA が出たら手動で解決してください。");
    log("  完了したら claude code に「ログインできた」等で伝えてください。");
    log("  claude code が以下を実行して完了通知します:");
    log(`    touch ${signal}`);
    log(`  最大 ${timeoutSec} 秒待ちます。`);
    log("==========================================");
    log("");

    const start = Date.now();
    while (Date.now() - start < timeoutSec * 1000) {
      if (existsSync(signal)) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!existsSync(signal)) {
      throw new Error(`login timeout (${timeoutSec}s): signal file ${signal} not created`);
    }

    log(`[login] signal 検出. cookie / client-code を抽出中...`);
    // ログイン直後はまだ API XHR が走っていない可能性があるので、
    // 自分のダッシュボードへ移動して x-note-client-code を確実に発火させる
    try {
      await page.goto("https://note.com/notes", { waitUntil: "domcontentloaded", timeout: 20000 });
    } catch {
      // 失敗しても cookie は取れる
    }
    await new Promise((r) => setTimeout(r, 2500));

    const allCookies = await ctx.cookies("https://note.com");
    const byName = Object.fromEntries(allCookies.map((c) => [c.name, c.value]));

    if (!byName._note_session_v5) {
      throw new Error("signal 受信したが _note_session_v5 cookie が無い (ログイン未完了の可能性)");
    }

    const cookies = buildCookieString(byName);

    // 既存エントリの email / clientCode は引き継ぐ
    const accounts = loadAccounts();
    const prev = accounts[accountName] || {};

    const record = {
      ...prev,
      cookies,
      clientCode: capturedClientCode || prev.clientCode || "",
      refreshedAt: new Date().toISOString(),
      refreshedVia: "browser_login",
    };

    if (persist) {
      accounts[accountName] = record;
      saveAccounts(accounts);
      log(`[login] saved to ${ACCOUNTS_FILE} (account=${accountName})`);
      log(`[login] cookies: ${cookies.slice(0, 60)}...`);
      log(`[login] clientCode: ${record.clientCode ? record.clientCode.slice(0, 12) + "..." : "(none)"}`);
    }

    return record;
  } finally {
    // signal ファイルは使い終わったので消す
    try { unlinkSync(signal); } catch {}
    await browser.close().catch(() => {});
  }
}
