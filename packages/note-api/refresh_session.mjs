// セッションリフレッシュ: CloakBrowser で対話ログインして accounts/note_accounts.json の cookie を更新。
//
// note の signin API は reCAPTCHA 必須になったため email/password の直接 POST は不可。
// 代わりに stealth ブラウザを開いて手動ログイン (reCAPTCHA 解決) → cookie を抽出して保存する。
//
// 使い方:
//   node refresh_session.mjs                  → personal_dev を更新
//   node refresh_session.mjs hirotodev0622    → 指定アカウントを更新
//
// ブラウザが開いたらログインし、完了したら別ターミナルで:
//   touch /tmp/note_login_<account>.ready
// （claude code 経由なら「ログインできた」と伝えれば自動で touch される）
//
// オプション: --timeout <sec> (signal 待ち最大秒, デフォルト 600) / --headless
import { browserLogin, defaultSignalFile } from "./lib/browser_login.mjs";

const args = process.argv.slice(2);
let accountName = null;
let timeoutSec = 600;
let headless = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--timeout") timeoutSec = Number(args[++i]);
  else if (a === "--headless") headless = true;
  else if (!a.startsWith("--") && !accountName) accountName = a;
}
accountName = accountName || "personal_dev";

const signal = defaultSignalFile(accountName);
console.log(`[refresh] account: ${accountName}`);
console.log(`SIGNAL_FILE=${signal}`);
console.log(`[refresh] ブラウザでログイン後: touch ${signal}`);

try {
  const record = await browserLogin({ accountName, signalFile: signal, timeoutSec, headless });
  console.log(`[refresh] done. account="${accountName}"`);
  console.log(`[refresh] new cookies:    ${(record.cookies || "").slice(0, 60)}...`);
  console.log(`[refresh] new clientCode: ${record.clientCode ? record.clientCode.slice(0, 12) + "..." : "(none)"}`);
} catch (e) {
  console.error(`[refresh] FAIL: ${e.message}`);
  process.exit(1);
}
