// X (Twitter) セッションを既存 Chrome プロファイルから CDP 経由で取り込む (threads-api/import_cdp.mjs の x.com 版)
//   node import_cdp.mjs --chrome-profile "Profile 3" [--account <name>] [--port 9345]
// --account 省略時は取得した screen_name をアカウント名にする.
import { spawn } from "child_process";
import { mkdtempSync, mkdirSync, copyFileSync, existsSync, rmSync } from "fs";
import { homedir, tmpdir } from "os";
import { join, dirname } from "path";
import { saveAccount } from "./session.mjs";
import { getProfileByRestId } from "./lib/profile.mjs";

const args = process.argv.slice(2);
let accountName = null, chromeProfile = "Default", port = 9345, preferLegacy = false;
let root = join(homedir(), "Library/Application Support/Google/Chrome");
let bin = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--account") accountName = args[++i];
  else if (args[i] === "--chrome-profile") chromeProfile = args[++i];
  else if (args[i] === "--port") port = Number(args[++i]);
  else if (args[i] === "--root") root = args[++i];
  else if (args[i] === "--bin") bin = args[++i];
  else if (args[i] === "--prefer-legacy") preferLegacy = true;
}
const tempDir = mkdtempSync(join(tmpdir(), "x_cdp_profile_"));
function tryCopy(rel) {
  const src = join(root, rel), dst = join(tempDir, rel);
  if (!existsSync(src)) return false;
  mkdirSync(dirname(dst), { recursive: true });
  try { copyFileSync(src, dst); return true; } catch { return false; }
}
tryCopy("Local State");
let got = false;
if (preferLegacy && existsSync(join(root, chromeProfile, "Cookies"))) {
  mkdirSync(join(tempDir, chromeProfile, "Network"), { recursive: true });
  copyFileSync(join(root, chromeProfile, "Cookies"), join(tempDir, chromeProfile, "Network", "Cookies"));
  got = true;
} else {
  got = tryCopy(join(chromeProfile, "Network", "Cookies")) || tryCopy(join(chromeProfile, "Cookies"));
}
if (!got) { console.error(`Cookies DB not found for profile "${chromeProfile}"`); rmSync(tempDir, { recursive: true, force: true }); process.exit(1); }
const proc = spawn(bin, [
  `--remote-debugging-port=${port}`, `--user-data-dir=${tempDir}`, "--headless=new",
  "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--disable-extensions", "--disable-sync", "--no-startup-window",
], { stdio: "ignore" });
let cleaned = false;
function cleanup() { if (cleaned) return; cleaned = true; try { proc.kill("SIGKILL"); } catch {} try { rmSync(tempDir, { recursive: true, force: true }); } catch {} }
process.on("exit", cleanup);
let wsUrl = null;
for (let i = 0; i < 40 && !wsUrl; i++) {
  await new Promise((r) => setTimeout(r, 400));
  try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) wsUrl = (await r.json()).webSocketDebuggerUrl; } catch {}
}
if (!wsUrl) { console.error("debug port did not open"); cleanup(); process.exit(2); }
const cookies = await new Promise((resolve, reject) => {
  const ws = new WebSocket(wsUrl);
  const to = setTimeout(() => reject(new Error("CDP timeout")), 15000);
  ws.addEventListener("open", () => ws.send(JSON.stringify({ id: 1, method: "Storage.getCookies", params: {} })));
  ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id === 1) { clearTimeout(to); ws.close(); m.error ? reject(new Error(m.error.message)) : resolve(m.result.cookies || []); } });
  ws.addEventListener("error", () => { clearTimeout(to); reject(new Error("WS error")); });
}).catch((e) => { console.error(`CDP failed: ${e.message}`); cleanup(); process.exit(3); });
const byName = {};
for (const c of cookies) if ((c.domain || "").endsWith("x.com")) byName[c.name] = c.value;
if (!byName.auth_token || !byName.ct0) { console.error(`x.com auth_token/ct0 missing in profile "${chromeProfile}" (have: ${Object.keys(byName).join(",")})`); cleanup(); process.exit(4); }
const twid = byName.twid || "";
const m = decodeURIComponent(twid).match(/u=(\d+)/);
const userId = m ? m[1] : null;
const order = ["auth_token", "ct0", "twid", "kdt", "att", "guest_id", "personalization_id", "lang"];
const names = [...order.filter((n) => byName[n]), ...Object.keys(byName).filter((n) => !order.includes(n))];
const record = {
  user_id: userId, auth_token: byName.auth_token, ct0: byName.ct0, twid: byName.twid, kdt: byName.kdt, att: byName.att,
  guest_id: byName.guest_id, personalization_id: byName.personalization_id,
  cookies: names.map((n) => `${n}=${byName[n]}`).join("; "),
  refreshed_at: new Date().toISOString(), refreshed_via: "manual", imported_from: { method: "cdp", profile: chromeProfile },
};
cleanup();
const p = await getProfileByRestId(record, { userId });
if (!p?.screen_name) { console.error("profile fetch failed — cookies may be stale"); process.exit(5); }
const name = accountName || p.screen_name;
record.screen_name = p.screen_name;
saveAccount(name, record);
console.log(`OK: imported "${name}" (@${p.screen_name}, user_id=${userId}) from Chrome profile "${chromeProfile}"  followers=${p.followers_count}`);
