// X (Twitter) 対話ログイン CLI.
// CloakBrowser を windowed で起動 → ユーザーが手動でログイン → claude code が signal file 作成 → cookies 自動保存。
//
// claude code 向け使い方:
//   1. このコマンドを背景起動 (run_in_background: true):
//        node libs/x-api/login_browser.mjs --account hirotohiroto_x
//   2. 起動ログに表示される signal file パスをメモ (例: /tmp/x_login_hirotohiroto_x.ready)
//   3. ユーザーに「ブラウザでログインしてください」と伝える
//   4. ユーザーが「ok」「ログインできた」等で合図したら:
//        touch /tmp/x_login_hirotohiroto_x.ready
//   5. 背景タスク完了通知を待つ
//
// 単独使い方 (terminal):
//   $ node libs/x-api/login_browser.mjs --account foo &
//   # ブラウザでログイン後
//   $ touch /tmp/x_login_foo.ready
//
// オプション:
//   --account <name>       保存先アカウント名 (必須)
//   --signal <path>        signal file パス上書き (デフォルト /tmp/x_login_<account>.ready)
//   --timeout <sec>        signal 待ち最大秒 (デフォルト 600)
//   --headless             (debug) ヘッドレス起動
//   --skip-validate        ログイン後の isSessionAlive チェックをスキップ

import { browserLogin, defaultSignalFile } from "./lib/browser_login.mjs";
import { isSessionAlive } from "./session.mjs";

const args = process.argv.slice(2);
let accountName = null;
let signalFile = null;
let timeoutSec = 600;
let headless = false;
let skipValidate = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--account") accountName = args[++i];
  else if (a === "--signal") signalFile = args[++i];
  else if (a === "--timeout") timeoutSec = Number(args[++i]);
  else if (a === "--headless") headless = true;
  else if (a === "--skip-validate") skipValidate = true;
  else if (a === "--help" || a === "-h") {
    console.log("usage: node login_browser.mjs --account <name> [--signal <path>] [--timeout 600] [--headless] [--skip-validate]");
    process.exit(0);
  }
}
if (!accountName) {
  console.error("usage: node login_browser.mjs --account <name> [--signal <path>] [--timeout 600] [--headless] [--skip-validate]");
  process.exit(1);
}

const resolvedSignal = signalFile || defaultSignalFile(accountName);

// claude code 向けの machine-readable な signal path を最初に出す
console.log(`SIGNAL_FILE=${resolvedSignal}`);

try {
  const record = await browserLogin({ accountName, signalFile: resolvedSignal, timeoutSec, headless });
  console.log(`✅ logged in. user_id=${record.user_id || "?"}`);

  if (!skipValidate) {
    console.log(`[validate] checking session via /1.1/account/settings.json ...`);
    const alive = await isSessionAlive(accountName);
    if (alive) {
      console.log(`✅ session alive`);
    } else {
      console.error(`⚠️ session not detected as alive. cookies saved, but verify manually with check_session.mjs`);
      process.exit(2);
    }
  }
} catch (e) {
  console.error(`FAIL: ${e.message}`);
  if (e.stack) console.error(e.stack.split("\n").slice(1, 4).join("\n"));
  process.exit(1);
}
