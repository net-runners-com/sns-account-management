#!/usr/bin/env node
// ============================================================================
// threads_login_cdp.mjs — ブラウザを開いてユーザーが手動ログイン → CDPでcookie取得
// ----------------------------------------------------------------------------
// プロファイル複製版 (threads_import_cdp.mjs) と違い、こっちは「新規ログイン」用。
//   1. まっさらな temp プロファイルで Chrome を画面表示で起動 (debug port 付き)
//   2. ログインページを開く → ★ユーザーが手で username/password 入力してログイン★
//   3. CDP で cookie を polling、sessionid が出たら取得 → accounts JSON 保存
//   4. Chrome kill + temp 削除
// パスワードはユーザーが入力 (スクリプトは入力しない)。OS非依存 (CDP / 追加依存なし)。
//
// 使い方:
//   node threads_login_cdp.mjs --account newacct --domain threads.com
//   node threads_login_cdp.mjs --account ig2 --domain instagram.com --out accounts/instagram_accounts.json
//
// 引数: --account(必須) / --domain(threads.com|instagram.com) / --out / --port(9336) / --timeout(秒,default 240)
// ============================================================================
import { spawn } from "child_process";
import { mkdtempSync, existsSync, writeFileSync, readFileSync, rmSync } from "fs";
import { homedir, tmpdir, platform } from "os";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";

const BUNDLE_DIR = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
let accountName = null, domain = "threads.com", outPath = null, port = 9336, timeoutSec = 240;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--account") accountName = args[++i];
  else if (args[i] === "--domain") domain = args[++i];
  else if (args[i] === "--out") outPath = args[++i];
  else if (args[i] === "--port") port = Number(args[++i]);
  else if (args[i] === "--timeout") timeoutSec = Number(args[++i]);
}
if (!accountName) { console.error("usage: node threads_login_cdp.mjs --account <name> [--domain threads.com|instagram.com] [--out path] [--timeout 240]"); process.exit(1); }
const isIG = domain.startsWith("instagram");
if (!outPath) outPath = (!isIG && process.env.THREADS_ACCOUNTS_PATH)
  ? resolve(process.env.THREADS_ACCOUNTS_PATH)
  : resolve(BUNDLE_DIR, "accounts", isIG ? "instagram_accounts.json" : "threads_accounts.json");
const loginUrl = isIG ? "https://www.instagram.com/accounts/login/" : "https://www.threads.com/login";

const OS = platform();
function chromeBin() {
  if (OS === "darwin") return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (OS === "win32") {
    for (const p of [join(process.env["PROGRAMFILES"] || "C:/Program Files", "Google/Chrome/Application/chrome.exe"),
                     join(process.env["PROGRAMFILES(X86)"] || "C:/Program Files (x86)", "Google/Chrome/Application/chrome.exe")])
      if (existsSync(p)) return p;
    return "chrome.exe";
  }
  for (const p of ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"])
    if (existsSync(p)) return p;
  return "google-chrome";
}

// ── 1. 画面表示で Chrome 起動 (新規 temp プロファイル + debug port + login URL) ──
const tempDir = mkdtempSync(join(tmpdir(), "cdp_login_"));
const proc = spawn(chromeBin(), [
  `--remote-debugging-port=${port}`, `--user-data-dir=${tempDir}`,
  "--no-first-run", "--no-default-browser-check", "--disable-sync",
  "--new-window", loginUrl,
], { detached: false, stdio: "ignore" });
let cleaned = false;
function cleanup() { if (cleaned) return; cleaned = true; try { proc.kill("SIGKILL"); } catch {} try { rmSync(tempDir, { recursive: true, force: true }); } catch {} }
process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(130); });

console.log(`\n┌──────────────────────────────────────────────────────────┐`);
console.log(`│  Chrome を開きました。表示された画面で ${isIG ? "Instagram" : "Threads"} に          │`);
console.log(`│  手動ログインしてください (username / password 入力)。       │`);
console.log(`│  ログイン検知で自動保存します。 (timeout ${String(timeoutSec).padEnd(3)}秒)            │`);
console.log(`└──────────────────────────────────────────────────────────┘\n`);

// ── 2. debug port 待ち → browser WS ──
async function getWsUrl() {
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 400));
    try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) { const j = await r.json(); if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl; } } catch {}
  }
  return null;
}
const wsUrl = await getWsUrl();
if (!wsUrl) { console.error(`[!] debug port ${port} が開かなかった`); cleanup(); process.exit(2); }

// ── 3. CDP Storage.getCookies を polling、sessionid 検出まで待つ ──
function cdpCall(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1e9);
    const onMsg = (ev) => { let m; try { m = JSON.parse(ev.data); } catch { return; } if (m.id === id) { ws.removeEventListener("message", onMsg); m.error ? reject(new Error(m.error.message)) : resolve(m.result); } };
    ws.addEventListener("message", onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}
const ws = await new Promise((resolve, reject) => {
  const s = new WebSocket(wsUrl);
  s.addEventListener("open", () => resolve(s));
  s.addEventListener("error", () => reject(new Error("WS error")));
});

const start = Date.now();
let map = null;
while (Date.now() - start < timeoutSec * 1000) {
  await new Promise(r => setTimeout(r, 1500));
  let cookies;
  try { ({ cookies } = await cdpCall(ws, "Storage.getCookies")); } catch { continue; }
  const want = (cookies || []).filter(c => (c.domain || "").includes(domain));
  const m = {}; for (const c of want) m[c.name] = c.value;
  if (m.sessionid && m.sessionid.includes("%3A") || (m.sessionid && m.sessionid.includes(":"))) {
    if (m.sessionid && m.ds_user_id && m.csrftoken) { map = m; break; }
  }
  process.stdout.write(`\r  ...ログイン待ち ${Math.floor((Date.now() - start) / 1000)}s  (検出cookie: ${Object.keys(m).join(",") || "none"})        `);
}
process.stdout.write("\n");
try { ws.close(); } catch {}

if (!map) { console.error(`[!] timeout: sessionid 未検出 (ログイン未完了 or 別ドメイン)`); cleanup(); process.exit(3); }

// ── 4. 保存 ──
const order = isIG ? ["sessionid","csrftoken","ds_user_id","ig_did","mid","rur","datr"]
                   : ["csrftoken","ig_did","rur","mid","ds_user_id","sessionid"];
const cookieHeader = order.filter(n => map[n]).map(n => `${n}=${map[n]}`).join("; ");
let all = {};
if (existsSync(outPath)) { try { all = JSON.parse(readFileSync(outPath, "utf8")); } catch { console.error(`[!] ${outPath} 壊れた JSON`); cleanup(); process.exit(5); } }
all[accountName] = {
  ...(all[accountName] || {}),
  ds_user_id: map.ds_user_id, csrftoken: map.csrftoken,
  ig_did: map.ig_did || all[accountName]?.ig_did || null, mid: map.mid || all[accountName]?.mid || null,
  cookies: cookieHeader,
  imported_via: { method: "cdp-login", domain, os: OS, at: new Date().toISOString() },
};
writeFileSync(outPath, JSON.stringify(all, null, 2) + "\n");
cleanup();
console.log(`\n=== ログイン成功・保存 (CDP) ===`);
console.log(`  account:       ${accountName}`);
console.log(`  out:           ${outPath}`);
console.log(`  ds_user_id:    ${map.ds_user_id}`);
console.log(`  sessionid len: ${map.sessionid.length}`);
