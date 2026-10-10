// note 対話ログイン CLI.
// CloakBrowser を windowed で起動 → ユーザーが手動でログイン (reCAPTCHA 解決) → claude code が signal file 作成 → cookie 自動保存。
//
// claude code 向け使い方:
//   1. このコマンドを背景起動 (run_in_background: true):
//        node login_browser.mjs --account personal_dev
//   2. 起動ログに表示される SIGNAL_FILE パスをメモ (例: /tmp/note_login_personal_dev.ready)
//   3. ユーザーに「ブラウザで note にログインしてください」と伝える
//   4. ユーザーが「ok」「ログインできた」等で合図したら:
//        touch /tmp/note_login_personal_dev.ready
//   5. 背景タスク完了通知を待つ
//
// 単独使い方 (terminal):
//   $ node login_browser.mjs --account personal_dev &
//   # ブラウザでログイン後
//   $ touch /tmp/note_login_personal_dev.ready
//
// オプション:
//   --account <name>   保存先アカウント名 (必須)
//   --signal <path>    signal file パス上書き (デフォルト /tmp/note_login_<account>.ready)
//   --timeout <sec>    signal 待ち最大秒 (デフォルト 600)
//   --headless         (debug) ヘッドレス起動

import { browserLogin, defaultSignalFile } from "./lib/browser_login.mjs";

const args = process.argv.slice(2);
let accountName = null;
let signalFile = null;
let timeoutSec = 600;
let headless = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--account") accountName = args[++i];
  else if (a === "--signal") signalFile = args[++i];
  else if (a === "--timeout") timeoutSec = Number(args[++i]);
  else if (a === "--headless") headless = true;
  else if (a === "--help" || a === "-h") {
    console.log("usage: node login_browser.mjs --account <name> [--signal <path>] [--timeout 600] [--headless]");
    process.exit(0);
  }
}
if (!accountName) {
  console.error("usage: node login_browser.mjs --account <name> [--signal <path>] [--timeout 600] [--headless]");
  process.exit(1);
}

const resolvedSignal = signalFile || defaultSignalFile(accountName);

// claude code 向けの machine-readable な signal path を最初に出す
console.log(`SIGNAL_FILE=${resolvedSignal}`);

try {
  const record = await browserLogin({ accountName, signalFile: resolvedSignal, timeoutSec, headless });
  console.log(`✅ logged in. account=${accountName}`);
  console.log(`   cookies: ${(record.cookies || "").slice(0, 60)}...`);
  console.log(`   clientCode: ${record.clientCode ? record.clientCode.slice(0, 12) + "..." : "(none)"}`);
} catch (e) {
  console.error(`FAIL: ${e.message}`);
  if (e.stack) console.error(e.stack.split("\n").slice(1, 4).join("\n"));
  process.exit(1);
}
