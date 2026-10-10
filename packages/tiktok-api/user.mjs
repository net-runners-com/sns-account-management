// TikTok ユーザー投稿動画 一覧 CLI (Camoufox 経由, ORCAS bypass)
//
//   node user.mjs xxpeony                              # @xxpeony の投稿を新着順 30件
//   node user.mjs @xxpeony --count 50                  # 50件
//   node user.mjs https://www.tiktok.com/@xxpeony      # URL でも可
//   node user.mjs xxpeony --sort likes                 # いいね順
//   node user.mjs xxpeony --min-likes 100000           # いいね 10万以上
//   node user.mjs xxpeony --headed                     # ブラウザUI表示 (デバッグ)
//   node user.mjs xxpeony --raw                        # 生 itemList JSON
//   node user.mjs xxpeony --pretty                     # 人間向け整形 (stderr)
//
// 流れ: プロフィールページを開く → /api/post/item_list/ のレスポンスを intercept
//       + __UNIVERSAL_DATA_FOR_REHYDRATION__ から userInfo / 初期投稿を fallback 取得
import { getAccount } from "./session.mjs";
import { launchCamoufox, captureApiResponses } from "./lib/browser.mjs";
import { summarizeVideo, summarizeUser, fmt, parseUsername } from "./lib/format.mjs";

const args = process.argv.slice(2);
let accountName = process.env.TIKTOK_ACCOUNT || "guest";
let count = 30, headed = false, raw = false, pretty = false;
let sort = "recent"; // recent | likes | views
let minLikes = 0, minViews = 0;
const positional = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--account") accountName = args[++i];
  else if (a === "--count") count = Number(args[++i]);
  else if (a === "--sort") sort = args[++i];
  else if (a === "--min-likes") minLikes = Number(args[++i]);
  else if (a === "--min-views") minViews = Number(args[++i]);
  else if (a === "--headed") headed = true;
  else if (a === "--raw") raw = true;
  else if (a === "--pretty") pretty = true;
  else positional.push(a);
}
const username = parseUsername(positional[0] || "");
if (!username) {
  console.error('usage: node user.mjs <username|@name|profile-url> [--sort recent|likes|views] [--min-likes N|--min-views N] [--count N|--headed|--raw|--pretty]');
  process.exit(1);
}

const acc = getAccount(accountName);
const { browser, ctx } = await launchCamoufox({ headless: !headed, acc, useCookies: accountName !== "guest" });
const page = await ctx.newPage();

const cap = captureApiResponses({
  page,
  urlPattern: /\/api\/post\/item_list\//,
  parser: (json) => json?.itemList || json?.aweme_list || [],
});

const url = `https://www.tiktok.com/@${encodeURIComponent(username)}`;
console.error(`[user] navigating ${url}`);
try { await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }); }
catch (e) { console.error(`[user] goto warn: ${e.message}`); }

await page.waitForTimeout(8000);

// scroll で件数を稼ぐ
let last = cap.collected.length, stable = 0;
for (let i = 0; i < 15 && cap.collected.length < count; i++) {
  await page.evaluate(() => window.scrollBy(0, document.body.scrollHeight));
  await page.waitForTimeout(1500 + Math.random() * 1000);
  if (cap.collected.length === last) { if (++stable >= 2) break; }
  else { stable = 0; last = cap.collected.length; }
}

// __UNIVERSAL_DATA_FOR_REHYDRATION__ から userInfo + 初期投稿を回収
const uni = await readUniversal(page);
const scope = uni?.__DEFAULT_SCOPE__ || {};
const userInfo = scope["webapp.user-detail"]?.userInfo || null;
const seeded = scope["webapp.user-detail"]?.itemList || scope["webapp.user-post"]?.itemList || [];

await browser.close();

// 重複排除しつつ intercept + seeded をマージ
const byId = new Map();
for (const it of [...cap.collected, ...seeded]) {
  const id = it.id || it.aweme_id;
  if (id && !byId.has(id)) byId.set(id, it);
}
let videos = [...byId.values()].map(summarizeVideo);

console.error(`[user] captured ${videos.length} videos (intercept=${cap.collected.length}, seeded=${seeded.length})`);

if (raw) {
  console.log(JSON.stringify({ user: userInfo, itemList: [...byId.values()] }, null, 2));
  process.exit(0);
}

const before = videos.length;
if (minLikes || minViews) {
  videos = videos.filter((v) => v.stats.digg >= minLikes && v.stats.play >= minViews);
}
if (sort === "likes") videos.sort((a, b) => b.stats.digg - a.stats.digg);
else if (sort === "views") videos.sort((a, b) => b.stats.play - a.stats.play);
else videos.sort((a, b) => (b.create_time || 0) - (a.create_time || 0)); // recent
videos = videos.slice(0, count);

const user = userInfo ? summarizeUser(userInfo) : { unique_id: username };

if (pretty) {
  if (user.nickname || user.follower_count) {
    console.error(`@${user.unique_id}${user.verified ? " ✔" : ""}  ${user.nickname || ""}  👥${fmt(user.follower_count)}  🎬${fmt(user.video_count)}  ❤${fmt(user.heart_count)}`);
    console.error("─".repeat(70));
  }
  for (const v of videos) {
    const d = v.create_time ? new Date(v.create_time * 1000).toISOString().slice(0, 10) : "?";
    const cap2 = (v.desc || "").replace(/\n/g, " ").slice(0, 50);
    console.error(`[${d}] ▶${fmt(v.stats.play)} ❤${fmt(v.stats.digg)} 💬${fmt(v.stats.comment)} 🔁${fmt(v.stats.share)}  ${cap2}`);
    console.error(`   ${v.url}`);
  }
  console.error(`\n${videos.length} videos${before !== videos.length ? ` (filtered from ${before})` : ""}`);
} else {
  console.log(JSON.stringify({ user, sort, filters: { minLikes, minViews }, count: videos.length, videos }, null, 2));
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
