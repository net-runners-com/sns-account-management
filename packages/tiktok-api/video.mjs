// TikTok 個別動画 詳細 CLI (Camoufox 経由, ORCAS bypass)
//
//   node video.mjs https://www.tiktok.com/@xxpeony/video/7400000000000000000
//   node video.mjs 7400000000000000000 --author xxpeony      # id + 投稿者でも可
//   node video.mjs <url> --pretty                            # 人間向け整形
//   node video.mjs <url> --raw                               # 生 itemStruct JSON
//
// 流れ: 動画ページを開く → /api/item/detail/ のレスポンスを intercept
//       + __UNIVERSAL_DATA_FOR_REHYDRATION__ の webapp.video-detail を fallback
import { getAccount } from "./session.mjs";
import { launchCamoufox, captureApiResponses } from "./lib/browser.mjs";
import { summarizeDetail, fmt, parseVideoRef } from "./lib/format.mjs";

const args = process.argv.slice(2);
let accountName = process.env.TIKTOK_ACCOUNT || "guest";
let headed = false, raw = false, pretty = false, author = null;
const positional = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--account") accountName = args[++i];
  else if (a === "--author") author = args[++i];
  else if (a === "--headed") headed = true;
  else if (a === "--raw") raw = true;
  else if (a === "--pretty") pretty = true;
  else positional.push(a);
}
const ref = parseVideoRef(positional[0] || "");
if (positional[0] && !author) author = ref.author;
if (!ref.id) {
  console.error('usage: node video.mjs <video-url|id> [--author name] [--headed|--raw|--pretty]');
  process.exit(1);
}
// 投稿者が分かれば canonical URL、不明なら @i/video/<id> (TikTok が canonical へ redirect)
const url = `https://www.tiktok.com/@${author || "i"}/video/${ref.id}`;

const acc = getAccount(accountName);
const { browser, ctx } = await launchCamoufox({ headless: !headed, acc, useCookies: accountName !== "guest" });
const page = await ctx.newPage();

const cap = captureApiResponses({
  page,
  urlPattern: /\/api\/item\/detail\//,
  parser: (json) => (json?.itemInfo?.itemStruct ? [json.itemInfo.itemStruct] : []),
});

console.error(`[video] navigating ${url}`);
try { await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }); }
catch (e) { console.error(`[video] goto warn: ${e.message}`); }

await page.waitForTimeout(7000);

// __UNIVERSAL_DATA_FOR_REHYDRATION__ → webapp.video-detail を fallback で取得
const uni = await readUniversal(page);
const scope = uni?.__DEFAULT_SCOPE__ || {};
const fromUniversal = scope["webapp.video-detail"]?.itemInfo?.itemStruct || null;

await browser.close();

const item = cap.collected[0] || fromUniversal;
if (!item) {
  console.error(`[video] 詳細が取得できませんでした (login wall / 非公開 / 削除済の可能性). id=${ref.id}`);
  process.exit(2);
}
console.error(`[video] source=${cap.collected[0] ? "api/item/detail" : "universal-data"}`);

if (raw) { console.log(JSON.stringify(item, null, 2)); process.exit(0); }

const d = summarizeDetail(item);

if (pretty) {
  console.error(`@${d.author.unique_id}${d.author.verified ? " ✔" : ""}  ${d.author.nickname || ""}`);
  console.error(`${d.url}`);
  console.error(`投稿: ${d.create_time_iso?.slice(0, 16).replace("T", " ") || "?"}  尺: ${d.video.duration ?? "?"}s  地域: ${d.region || "?"}`);
  console.error("─".repeat(70));
  console.error((d.desc || "(no caption)").trim());
  if (d.hashtags.length) console.error("タグ: " + d.hashtags.map((h) => "#" + h).join(" "));
  if (d.mentions.length) console.error("メンション: " + d.mentions.map((m) => "@" + m).join(" "));
  console.error("─".repeat(70));
  console.error(`▶ ${fmt(d.stats.play)}  ❤ ${fmt(d.stats.digg)}  💬 ${fmt(d.stats.comment)}  🔁 ${fmt(d.stats.share)}  🔖 ${fmt(d.stats.collect)}`);
  if (d.music) console.error(`🎵 ${d.music.title || ""} — ${d.music.author || ""}${d.music.original ? " (original)" : ""}`);
  if (d.video.play_url) console.error(`mp4: ${d.video.play_url}`);
} else {
  console.log(JSON.stringify(d, null, 2));
}

async function readUniversal(page) {
  try {
    return await page.evaluate(() => {
      const el = document.getElementById("__UNIVERSAL_DATA_FOR_REHYDRATION__");
      if (!el) return null;
      try { return JSON.parse(el.textContent); } catch { return null; }
    });
  } catch { return null; }
}
