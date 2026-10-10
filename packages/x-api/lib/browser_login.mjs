// CloakBrowser でブラウザを起動して X (Twitter) ログインを対話的に行う。
// ログイン完了の通知は signal file ハンドシェイク方式:
//
//   1. このスクリプトはブラウザを開いて signal file が出現するまで待つ
//   2. ユーザーがブラウザでログイン
//   3. ユーザーが claude code に「ログインできた」と伝える
//   4. claude code が `touch <signalFile>` を実行
//   5. このスクリプトが signal を検出して cookies を抽出 → 保存
//
// programmatic 使用例:
//   import { browserLogin } from "./lib/browser_login.mjs";
//   const result = await browserLogin({ accountName: "foo" });

import { existsSync, unlinkSync } from "fs";
import { saveAccount } from "../session.mjs";

const COOKIE_NAMES = ["auth_token", "ct0", "twid", "kdt", "att", "guest_id", "personalization_id"];

export function defaultSignalFile(accountName) {
  return `/tmp/x_login_${accountName}.ready`;
}

function parseUserIdFromTwid(twid) {
  if (!twid) return null;
  const m = decodeURIComponent(twid).match(/u=(\d+)/);
  return m ? m[1] : null;
}

function buildCookieString(byName) {
  const parts = [];
  for (const k of COOKIE_NAMES) {
    if (byName[k]) parts.push(`${k}=${byName[k]}`);
  }
  parts.push("lang=en");
  return parts.join("; ");
}

/**
 * @param {Object} opts
 * @param {string} opts.accountName  保存先アカウント名 (saveAccount に渡す)
 * @param {string} [opts.signalFile]  ログイン完了を通知するファイルパス. デフォルト: /tmp/x_login_<account>.ready
 * @param {number} [opts.timeoutSec=600]  signal 待ち最大秒
 * @param {boolean} [opts.headless=false]  ヘッドレス起動 (debug 用. 対話ログインには false)
 * @param {boolean} [opts.persist=true]  accounts/x_accounts.json に保存するか
 * @param {(msg:string)=>void} [opts.log=console.error]  進捗ログ出力
 * @returns {Promise<{user_id:string, auth_token:string, ct0:string, twid:string, kdt?:string, att?:string, guest_id?:string, personalization_id?:string, cookies:string, refreshed_at:string, refreshed_via:string}>}
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
    locale: "en-US",
    timezone: "Asia/Tokyo",
  });
  try {
    const ctx = browser.contexts()[0] || (await browser.newContext());
    const page = await ctx.newPage();

    log(`[login] navigating to https://x.com/login`);
    await page.goto("https://x.com/login", { waitUntil: "domcontentloaded" });

    log("");
    log("==========================================");
    log("  ブラウザで X にログインしてください。");
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

    log(`[login] signal 検出. cookies を抽出中...`);
    // ct0 等が後から set される可能性があるので /home に移動して落ち着かせる
    try {
      await page.goto("https://x.com/home", { waitUntil: "domcontentloaded", timeout: 15000 });
    } catch {
      // home に行けなくても cookie は取れる
    }
    await new Promise((r) => setTimeout(r, 1500));

    const allCookies = await ctx.cookies("https://x.com");
    const byName = Object.fromEntries(allCookies.map((c) => [c.name, c.value]));

    if (!byName.auth_token) {
      throw new Error("signal 受信したが auth_token cookie が無い (ログイン未完了の可能性)");
    }

    const userId = parseUserIdFromTwid(byName.twid);
    const cookies = buildCookieString(byName);

    const record = {
      user_id: userId,
      auth_token: byName.auth_token,
      ct0: byName.ct0,
      twid: byName.twid,
      kdt: byName.kdt,
      att: byName.att,
      guest_id: byName.guest_id,
      personalization_id: byName.personalization_id,
      cookies,
      refreshed_at: new Date().toISOString(),
      refreshed_via: "browser_login",
    };

    if (persist) {
      saveAccount(accountName, record);
      log(`[login] saved to accounts/x_accounts.json (account=${accountName}, user_id=${userId})`);
    }

    return record;
  } finally {
    // signal ファイルは使い終わったので消す
    try { unlinkSync(signal); } catch {}
    await browser.close().catch(() => {});
  }
}
