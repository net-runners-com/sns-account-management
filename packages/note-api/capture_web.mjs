// note Web の API request を Playwright で全 capture
//
//   node --env-file=.env capture_web.mjs                     # note トップ
//   node --env-file=.env capture_web.mjs --url https://note.com/notifications
//   node --env-file=.env capture_web.mjs --filter notices    # 正規表現フィルタ
//
// /tmp/note_web_capture.jsonl に保存
import { chromium } from "playwright";
import { writeFileSync, appendFileSync } from "fs";

const args = process.argv.slice(2);
let startUrl = "https://note.com/";
let filterRe = /\/api\/v[0-9]+\//;
let outFile = "/tmp/note_web_capture.jsonl";
let timeoutMs = 600000;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--url") startUrl = args[++i];
  else if (args[i] === "--filter") filterRe = new RegExp(args[++i]);
  else if (args[i] === "--out") outFile = args[++i];
  else if (args[i] === "--timeout") timeoutMs = Number(args[++i]) * 1000;
}

const cookieStr = process.env.NOTE_COOKIES || "";
function parseCookies(s) {
  const out = [];
  for (const x of s.split(";")) {
    const e = x.indexOf("=");
    if (e < 0) continue;
    const n = x.slice(0, e).trim();
    const v = x.slice(e + 1).trim();
    if (!n) continue;
    out.push({ name: n, value: v, domain: ".note.com", path: "/", httpOnly: false, secure: true, sameSite: "None" });
  }
  return out;
}

const browser = await chromium.launch({ headless: false, args: ["--disable-blink-features=AutomationControlled"] });
const ctx = await browser.newContext({
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
  viewport: { width: 1280, height: 900 },
  locale: "ja-JP",
});
if (cookieStr) await ctx.addCookies(parseCookies(cookieStr));

const page = await ctx.newPage();
writeFileSync(outFile, "");
let count = 0;

page.on("request", (req) => {
  const url = req.url();
  if (!filterRe.test(url)) return;
  const body = req.postData() || null;
  count++;
  const entry = {
    n: count,
    method: req.method(),
    url: url.length > 200 ? url.slice(0, 200) + "..." : url,
    full_url: url,
    headers_oi: {
      "x-requested-with": req.headers()["x-requested-with"] || null,
      "content-type": req.headers()["content-type"] || null,
      "accept": req.headers()["accept"] || null,
    },
    body,
  };
  appendFileSync(outFile, JSON.stringify(entry) + "\n");
  console.log(`[${count}] ${req.method()} ${url.split("?")[0].split("/").slice(-3).join("/")}${url.includes("?") ? "?..." : ""}`);
});

page.on("response", async (res) => {
  const url = res.url();
  if (!filterRe.test(url)) return;
  // 200 系のみ body 短縮 dump
  if (res.status() < 200 || res.status() >= 300) return;
  try {
    const ct = res.headers()["content-type"] || "";
    if (!ct.includes("json")) return;
    const txt = await res.text();
    if (txt.length > 0 && txt.length < 30000) {
      // append response info
      appendFileSync(outFile, JSON.stringify({ n_response: count, url: url.slice(0, 100), status: res.status(), body_preview: txt.slice(0, 5000) }) + "\n");
    }
  } catch {}
});

await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 30000 }).catch((e) => console.error("goto err:", e.message));

console.log(`\n=== READY ===`);
console.log(`URL: ${startUrl}`);
console.log(`out: ${outFile}`);
console.log(`filter: ${filterRe}`);
console.log(`timeout: ${timeoutMs / 1000}s\n`);

await page.waitForTimeout(timeoutMs);
console.log(`\n=== ${count} requests captured ===`);
await browser.close();
