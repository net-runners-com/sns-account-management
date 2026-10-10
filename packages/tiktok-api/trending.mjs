// TikTok バズってる動画 (Explore / For You) CLI
//
//   node trending.mjs --account guest                    # default 20件
//   node trending.mjs --account guest --count 50
//   node trending.mjs --account guest --min-likes 10000
//   node trending.mjs --account guest --raw
import { getAccount } from "./session.mjs";
import { launchCamoufox, captureApiResponses } from "./lib/browser.mjs";

const args = process.argv.slice(2);
let accountName = process.env.TIKTOK_ACCOUNT || "guest";
let count = 20;
let headed = false;
let raw = false;
let minLikes = 0, minViews = 0;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--account") { accountName = args[++i]; continue; }
  if (a === "--count") { count = Number(args[++i]); continue; }
  if (a === "--min-likes") { minLikes = Number(args[++i]); continue; }
  if (a === "--min-views") { minViews = Number(args[++i]); continue; }
  if (a === "--headed") { headed = true; continue; }
  if (a === "--raw") { raw = true; continue; }
}

const acc = getAccount(accountName);
const { browser, ctx } = await launchCamoufox({ headless: !headed, acc, useCookies: accountName !== "guest" });
const page = await ctx.newPage();

// /api/recommend/item_list/ + /api/explore/item_list/ を intercept
const cap = captureApiResponses({
  page,
  urlPattern: /\/api\/(recommend|explore)\/item_list\//,
  parser: (json) => json?.itemList || json?.aweme_list || [],
});

const url = "https://www.tiktok.com/explore";
console.error(`[trending] navigating ${url}`);
try { await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }); }
catch (e) { console.error(`[trending] goto warn: ${e.message}`); }

await page.waitForTimeout(8000);

// scroll で件数稼ぐ (count*2 取って絞る)
const target = Math.max(count * 2, 40);
let lastCount = cap.collected.length, stable = 0;
for (let i = 0; i < 15 && cap.collected.length < target; i++) {
  await page.evaluate(() => window.scrollBy(0, document.body.scrollHeight));
  await page.waitForTimeout(1500 + Math.random() * 1000);
  if (cap.collected.length === lastCount) { if (++stable >= 2) break; }
  else { stable = 0; lastCount = cap.collected.length; }
}

console.error(`[trending] captured ${cap.collected.length} videos from ${cap.rawResponses.length} response(s)`);

if (raw) {
  console.log(JSON.stringify(cap.rawResponses, null, 2));
} else {
  let videos = cap.collected.map(summarizeVideo);
  // 重複排除 (同じ video_id が複数回 push されることある)
  const seen = new Set();
  videos = videos.filter((v) => v.id && !seen.has(v.id) && (seen.add(v.id), true));
  const before = videos.length;
  if (minLikes || minViews) {
    videos = videos.filter((v) => v.stats.digg >= minLikes && v.stats.play >= minViews);
  }
  // 必ずいいね順
  videos.sort((a, b) => b.stats.digg - a.stats.digg);
  videos = videos.slice(0, count);
  console.error(`[trending] result=${videos.length}${before !== videos.length ? ` (filtered/sliced from ${before})` : ""}`);
  console.log(JSON.stringify({ source: "explore", filters: { minLikes, minViews }, count: videos.length, videos }, null, 2));
}

await browser.close();

function summarizeVideo(it) {
  const author = it.author || {};
  const stats = it.stats || it.statsV2 || it.statistics || {};
  const authorStats = it.authorStats || {};
  return {
    id: it.id || it.aweme_id,
    desc: it.desc || "",
    create_time: it.createTime || it.create_time,
    duration: it.video?.duration,
    cover: typeof it.video?.cover === "string" ? it.video.cover : it.video?.cover?.url_list?.[0],
    play_url: typeof it.video?.playAddr === "string" ? it.video.playAddr : it.video?.play_addr?.url_list?.[0],
    url: author.uniqueId && (it.id || it.aweme_id)
      ? `https://www.tiktok.com/@${author.uniqueId}/video/${it.id || it.aweme_id}`
      : null,
    author: {
      id: author.id || author.uid,
      sec_uid: author.secUid || author.sec_uid,
      unique_id: author.uniqueId || author.unique_id,
      nickname: author.nickname,
      verified: !!author.verified,
      follower_count: authorStats.followerCount,
    },
    stats: {
      play: Number(stats.playCount ?? stats.play_count ?? 0),
      digg: Number(stats.diggCount ?? stats.digg_count ?? 0),
      comment: Number(stats.commentCount ?? stats.comment_count ?? 0),
      share: Number(stats.shareCount ?? stats.share_count ?? 0),
      collect: Number(stats.collectCount ?? stats.collect_count ?? 0),
    },
    music: it.music ? { id: it.music.id, title: it.music.title, author: it.music.authorName || it.music.author } : null,
  };
}
