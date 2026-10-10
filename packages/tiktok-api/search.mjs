// TikTok 検索 CLI (Camoufox 経由, ORCAS bypass)
//
//   node search.mjs --account guest "<keyword>"
//   node search.mjs --account guest --count 50 "<keyword>"
//   node search.mjs --account guest --sort likes "<keyword>"          # いいね順
//   node search.mjs --account guest --sort recent "<keyword>"         # 新着順
//   node search.mjs --account guest --days 7 "<keyword>"              # 直近 7 日
//   node search.mjs --account guest --min-likes 10000 "<keyword>"     # いいね 10K 以上
//   node search.mjs --account guest --min-views 1000000 "<keyword>"   # 100万再生 以上
//   node search.mjs --account guest --min-comments 100 "<keyword>"
//   node search.mjs --account guest --headed "<keyword>"              # browser UI 表示
//   node search.mjs --account guest --raw "<keyword>"                 # 生 JSON
import { getAccount } from "./session.mjs";
import { launchCamoufox, captureApiResponses } from "./lib/browser.mjs";

const args = process.argv.slice(2);
let accountName = process.env.TIKTOK_ACCOUNT || "guest";
let count = 20;
let headed = false;
let raw = false;
let sort = "relevance"; // relevance | likes | recent
let days = 0;            // 0=all, 1, 7, 30, 90, 180
let minLikes = 0, minViews = 0, minComments = 0;
const positional = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--account") { accountName = args[++i]; continue; }
  if (a === "--count") { count = Number(args[++i]); continue; }
  if (a === "--sort") { sort = args[++i]; continue; }
  if (a === "--days") { days = Number(args[++i]); continue; }
  if (a === "--min-likes") { minLikes = Number(args[++i]); continue; }
  if (a === "--min-views") { minViews = Number(args[++i]); continue; }
  if (a === "--min-comments") { minComments = Number(args[++i]); continue; }
  if (a === "--headed") { headed = true; continue; }
  if (a === "--raw") { raw = true; continue; }
  positional.push(a);
}
const keyword = positional.join(" ").trim();
if (!keyword) {
  console.error('usage: node search.mjs --account <name> [--sort relevance|likes|recent] [--days 0|1|7|30|90|180] [--min-likes N|--min-views N|--min-comments N] [--count N|--headed|--raw] "<keyword>"');
  process.exit(1);
}

const SORT_TYPE = { relevance: 0, likes: 1, recent: 2 }[sort];
if (SORT_TYPE === undefined) {
  console.error(`unknown --sort value: ${sort} (use relevance|likes|recent)`);
  process.exit(1);
}

const acc = getAccount(accountName);
// guest (read-only 検索) では cookie inject しない. ORCAS に古い msToken で flag されるのを回避.
const { browser, ctx } = await launchCamoufox({ headless: !headed, acc, useCookies: accountName !== "guest" });
const page = await ctx.newPage();

// /api/search/general/full/ の response を intercept
const cap = captureApiResponses({
  page,
  urlPattern: /\/api\/search\/general\/full\//,
  parser: (json) => json?.data || [],
});

const urlParams = new URLSearchParams({ q: keyword, t: String(Date.now()) });
if (SORT_TYPE !== 0) urlParams.set("sort_type", String(SORT_TYPE));
if (days > 0) urlParams.set("publish_time", String(days));
const url = `https://www.tiktok.com/search?${urlParams}`;
console.error(`[search] navigating ${url}`);

try {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
} catch (e) {
  console.error(`[search] goto warning: ${e.message}`);
}

// 初期ロード待ち (検索結果 API が来るまで; 短いと entries=0)
await page.waitForTimeout(8000);

// 件数足りなければ scroll
let lastCount = cap.collected.length;
let stableLoops = 0;
const maxScrolls = 12;
for (let i = 0; i < maxScrolls && cap.collected.length < count; i++) {
  await page.evaluate(() => window.scrollBy(0, document.body.scrollHeight));
  await page.waitForTimeout(1500 + Math.random() * 1000);
  if (cap.collected.length === lastCount) {
    stableLoops++;
    if (stableLoops >= 2) break;
  } else {
    stableLoops = 0;
    lastCount = cap.collected.length;
  }
}

console.error(`[search] captured ${cap.collected.length} entries from ${cap.rawResponses.length} response(s)`);

if (raw) {
  console.log(JSON.stringify(cap.rawResponses, null, 2));
} else {
  let { videos, users, hashtags } = summarize(cap.collected);
  const before = videos.length;
  if (minLikes || minViews || minComments) {
    videos = videos.filter((v) => v.stats.digg >= minLikes && v.stats.play >= minViews && v.stats.comment >= minComments);
  }
  if (sort === "likes") videos.sort((a, b) => b.stats.digg - a.stats.digg);
  else if (sort === "recent") videos.sort((a, b) => (b.create_time || 0) - (a.create_time || 0));
  console.error(`[search] videos=${videos.length}${before !== videos.length ? ` (filtered from ${before})` : ""} users=${users.length} hashtags=${hashtags.length}`);
  console.log(JSON.stringify({ keyword, sort, days, filters: { minLikes, minViews, minComments }, videos, users, hashtags }, null, 2));
}

await browser.close();

function summarize(entries) {
  const videos = [], users = [], hashtags = [];
  for (const e of entries) {
    if (e.type === 1 && e.item) videos.push(summarizeVideo(e.item));
    else if (e.type === 4 && Array.isArray(e.user_list)) for (const u of e.user_list) users.push(summarizeUser(u));
    else if (Array.isArray(e.aweme_info_list)) for (const v of e.aweme_info_list) videos.push(summarizeVideo(v));
    else if (e.item) videos.push(summarizeVideo(e.item));
    else if (e.user_info) users.push(summarizeUser(e));
    else if (e.challenge) hashtags.push(summarizeChallenge(e.challenge));
  }
  return { videos, users, hashtags };
}

function summarizeVideo(it) {
  const author = it.author || {};
  const stats = it.stats || it.statsV2 || it.statistics || {};
  const authorStats = it.authorStats || {};
  return {
    id: it.id || it.aweme_id,
    desc: it.desc || "",
    create_time: it.createTime || it.create_time,
    duration: it.video?.duration,
    cover: it.video?.cover || it.video?.cover?.url_list?.[0],
    play_url: it.video?.playAddr || it.video?.play_addr?.url_list?.[0],
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
      repost: Number(stats.repostCount ?? 0),
    },
    music: it.music
      ? { id: it.music.id, title: it.music.title, author: it.music.authorName || it.music.author }
      : null,
    is_ad: !!it.isAd,
  };
}

function summarizeUser(u) {
  const ui = u.user_info || u.userInfo || u.user || u;
  const stats = u.stats || u.statsV2 || ui.stats || {};
  return {
    id: ui.id || ui.uid,
    sec_uid: ui.secUid || ui.sec_uid,
    unique_id: ui.uniqueId || ui.unique_id,
    nickname: ui.nickname,
    signature: ui.signature,
    verified: !!ui.verified,
    avatar: ui.avatarThumb || ui.avatar_thumb?.url_list?.[0],
    follower_count: Number(stats.followerCount ?? ui.followerCount ?? ui.follower_count ?? 0),
    following_count: Number(stats.followingCount ?? ui.followingCount ?? ui.following_count ?? 0),
    video_count: Number(stats.videoCount ?? ui.videoCount ?? 0),
    heart_count: Number(stats.heartCount ?? ui.heartCount ?? 0),
  };
}

function summarizeChallenge(c) {
  return {
    id: c.id || c.cid,
    title: c.title || c.cha_name,
    desc: c.desc,
    cover: c.coverThumb,
    user_count: c.user_count,
    view_count: c.viewCount || c.view_count,
  };
}
