#!/usr/bin/env node
// ============================================================================
// threads_import_cdp.mjs — OS非依存・ブラウザベースの Threads/IG セッション取得
// ----------------------------------------------------------------------------
// Keychain / security コマンドを自前で叩かない。Chrome 本体に復号させて CDP で読む。
// 仕組み:
//   1. 既存 Chrome プロファイルの Cookies + Local State を temp にコピー
//   2. その複製 user-data-dir で headless Chrome を --remote-debugging-port 付き起動
//      (Chrome136+ は default profile の debugging を禁止 → 複製 dir なら回避)
//   3. CDP (Storage.getCookies) で httpOnly 込みの全 cookie を取得
//   4. threads.com / instagram.com を抽出 → accounts JSON に保存
//   5. Chrome kill + temp 削除
//
// 使い方:
//   node threads_import_cdp.mjs --account myaccount
//   node threads_import_cdp.mjs --account me --domain instagram.com --out ./ig.json
//   node threads_import_cdp.mjs --account me --chrome-profile "Profile 1" --print
//
// 引数: --account / --out / --domain (threads.com|instagram.com) /
//        --chrome-profile (default "Default") / --port (9335) / --print / --keep-window
// 対応: macOS / Linux / Windows (Node 21+ の native WebSocket 使用、追加依存なし)
// ============================================================================
import { spawn } from "child_process";
import { mkdtempSync, mkdirSync, copyFileSync, existsSync, writeFileSync, readFileSync, rmSync } from "fs";
import { homedir, tmpdir, platform } from "os";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";

const BUNDLE_DIR = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
let accountName = null, chromeProfile = "Default", domain = "threads.com";
let outPath = null, port = 9335, printOnly = false, keepWindow = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--account") accountName = args[++i];
  else if (args[i] === "--chrome-profile") chromeProfile = args[++i];
  else if (args[i] === "--domain") domain = args[++i];
  else if (args[i] === "--out") outPath = args[++i];
  else if (args[i] === "--port") port = Number(args[++i]);
  else if (args[i] === "--print") printOnly = true;
  else if (args[i] === "--keep-window") keepWindow = true;
}
if (!accountName && !printOnly) {
  console.error("usage: node threads_import_cdp.mjs --account <name> [--domain threads.com|instagram.com] [--out path] [--chrome-profile Default] [--print]");
  process.exit(1);
}
if (!outPath) outPath = (!domain.startsWith("instagram") && process.env.THREADS_ACCOUNTS_PATH)
  ? resolve(process.env.THREADS_ACCOUNTS_PATH)
  : resolve(BUNDLE_DIR, "accounts", domain.startsWith("instagram") ? "instagram_accounts.json" : "threads_accounts.json");

const OS = platform();
// ── Chrome バイナリ & プロファイルルート (OS別) ──
function chromeBin() {
  if (OS === "darwin") return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (OS === "win32") {
    for (const p of [
      join(process.env["PROGRAMFILES"] || "C:/Program Files", "Google/Chrome/Application/chrome.exe"),
      join(process.env["PROGRAMFILES(X86)"] || "C:/Program Files (x86)", "Google/Chrome/Application/chrome.exe"),
    ]) if (existsSync(p)) return p;
    return "chrome.exe";
  }
  for (const p of ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"])
    if (existsSync(p)) return p;
  return "google-chrome";
}
function profileRoot() {
  if (OS === "darwin") return join(homedir(), "Library/Application Support/Google/Chrome");
  if (OS === "win32") return join(process.env.LOCALAPPDATA || join(homedir(), "AppData/Local"), "Google/Chrome/User Data");
  return join(homedir(), ".config/google-chrome");
}

// ── 1. プロファイルを temp に複製 (Cookies + Local State だけ) ──
const root = profileRoot();
if (!existsSync(root)) { console.error(`[!] Chrome profile root not found: ${root}`); process.exit(1); }
const tempDir = mkdtempSync(join(tmpdir(), "cdp_profile_"));
function tryCopy(rel) {
  const src = join(root, rel), dst = join(tempDir, rel);
  if (!existsSync(src)) return false;
  mkdirSync(dirname(dst), { recursive: true });
  try { copyFileSync(src, dst); return true; } catch { return false; }
}
tryCopy("Local State"); // 暗号鍵メタ (Windows DPAPI 等)
const gotNet = tryCopy(join(chromeProfile, "Network", "Cookies"));   // 新形式
const gotLeg = tryCopy(join(chromeProfile, "Cookies"));              // 旧形式
// WAL/journal も一応
tryCopy(join(chromeProfile, "Network", "Cookies-journal"));
if (!gotNet && !gotLeg) { console.error(`[!] Cookies DB が見つからない (profile="${chromeProfile}"). --chrome-profile を確認.`); rmSync(tempDir, { recursive: true, force: true }); process.exit(1); }
console.log(`[1] profile 複製 → ${tempDir}`);

// ── 2. 複製 dir で headless Chrome 起動 (--remote-debugging-port) ──
const chromeArgs = [
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${tempDir}`,
  keepWindow ? "" : "--headless=new",
  "--no-first-run", "--no-default-browser-check", "--disable-gpu",
  "--disable-extensions", "--disable-sync", "--no-startup-window",
].filter(Boolean);
const proc = spawn(chromeBin(), chromeArgs, { detached: false, stdio: "ignore" });
let cleaned = false;
function cleanup() {
  if (cleaned) return; cleaned = true;
  try { proc.kill("SIGKILL"); } catch {}
  try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
}
process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(130); });

// ── 3. debug port が開くのを待つ → browser WS 取得 ──
async function getWsUrl() {
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 400));
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) { const j = await r.json(); if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl; }
    } catch {}
  }
  return null;
}
const wsUrl = await getWsUrl();
if (!wsUrl) { console.error(`[!] debug port ${port} が開かなかった (Chrome起動失敗?)`); cleanup(); process.exit(2); }
console.log(`[2] headless Chrome 起動・CDP 接続 (port ${port})`);

// ── 4. CDP Storage.getCookies で全 cookie 取得 ──
function cdpCall(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1e9);
    const onMsg = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.id === id) { ws.removeEventListener("message", onMsg); m.error ? reject(new Error(m.error.message)) : resolve(m.result); }
    };
    ws.addEventListener("message", onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}
const cookies = await new Promise(async (resolve, reject) => {
  const ws = new WebSocket(wsUrl);
  const to = setTimeout(() => reject(new Error("CDP timeout")), 15000);
  ws.addEventListener("open", async () => {
    try {
      const { cookies } = await cdpCall(ws, "Storage.getCookies");
      clearTimeout(to); ws.close(); resolve(cookies || []);
    } catch (e) { clearTimeout(to); ws.close(); reject(e); }
  });
  ws.addEventListener("error", () => { clearTimeout(to); reject(new Error("WS error")); });
}).catch(e => { console.error(`[!] CDP 取得失敗: ${e.message}`); cleanup(); process.exit(3); });

// ── 5. domain 抽出 ──
const want = cookies.filter(c => (c.domain || "").includes(domain));
const map = {};
for (const c of want) map[c.name] = c.value;
console.log(`[3] ${cookies.length} cookies 取得 → ${domain} 一致 ${want.length} (${Object.keys(map).join(",")})`);

const need = ["sessionid", "csrftoken", "ds_user_id"];
const missing = need.filter(n => !map[n]);
if (missing.length) {
  console.error(`[!] required cookies missing: ${missing.join(",")} — そのプロファイルで ${domain} にログイン済か確認`);
  cleanup(); process.exit(4);
}
const order = domain.startsWith("instagram")
  ? ["sessionid","csrftoken","ds_user_id","ig_did","mid","rur","datr"]
  : ["csrftoken","ig_did","rur","mid","ds_user_id","sessionid"];
const cookieHeader = order.filter(n => map[n]).map(n => `${n}=${map[n]}`).join("; ");

if (printOnly) {
  cleanup();
  console.log(`\n=== extracted (not saved) ===`);
  console.log(`  ds_user_id:    ${map.ds_user_id}`);
  console.log(`  sessionid len: ${map.sessionid.length}`);
  console.log(`  cookie header: ${cookieHeader}`);
  process.exit(0);
}

let all = {};
if (existsSync(outPath)) { try { all = JSON.parse(readFileSync(outPath, "utf8")); } catch { console.error(`[!] ${outPath} 壊れた JSON. 中止.`); cleanup(); process.exit(5); } }
all[accountName] = {
  ...(all[accountName] || {}),
  ds_user_id: map.ds_user_id, csrftoken: map.csrftoken,
  ig_did: map.ig_did || all[accountName]?.ig_did || null,
  mid: map.mid || all[accountName]?.mid || null,
  cookies: cookieHeader,
  imported_via: { method: "cdp", domain, profile: chromeProfile, os: OS, at: new Date().toISOString() },
};
writeFileSync(outPath, JSON.stringify(all, null, 2) + "\n");
cleanup();
console.log(`\n=== imported (CDP) ===`);
console.log(`  account:       ${accountName}`);
console.log(`  out:           ${outPath}`);
console.log(`  ds_user_id:    ${map.ds_user_id}`);
console.log(`  sessionid len: ${map.sessionid.length}`);
