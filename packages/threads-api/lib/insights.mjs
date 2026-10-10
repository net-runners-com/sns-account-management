// Threads アカウント Insights (web GraphQL BarcelonaInsightsPageAccountInsightsQuery)
//
//   variables: { startDate: "YYYY-MM-DD", endDate: "YYYY-MM-DD", timeZoneID: "ASIA_TOKYO" }
//   referer:   https://www.threads.com/insights
//   crn:       comet.threads.BarcelonaInsightsColumnRoute
import { callGraphQL } from "./graphql.mjs";

function fmt(d) {
  return d.toISOString().slice(0, 10);
}

/**
 * 自アカウントの Insights を取得
 * @param {object} opts
 * @param {string} opts.accountName  ログイン中アカウント (own profile only)
 * @param {string} [opts.startDate]  YYYY-MM-DD (default: 30 days ago)
 * @param {string} [opts.endDate]    YYYY-MM-DD (default: yesterday)
 * @param {string} [opts.timeZoneID] e.g. "ASIA_TOKYO" (default ASIA_TOKYO)
 */
export async function getAccountInsights({ accountName, startDate, endDate, timeZoneID = "ASIA_TOKYO" } = {}) {
  if (!startDate || !endDate) {
    const today = new Date();
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    const start = new Date(yesterday.getTime() - 29 * 24 * 60 * 60 * 1000);
    startDate = startDate || fmt(start);
    endDate = endDate || fmt(yesterday);
  }
  return await callGraphQL({
    accountName,
    friendlyName: "BarcelonaInsightsPageAccountInsightsQuery",
    variables: { startDate, endDate, timeZoneID },
    referer: "https://www.threads.com/insights",
    crn: "comet.threads.BarcelonaInsightsColumnRoute",
  });
}

/**
 * getAccountInsights() の結果を読みやすい形に集約
 */
export function summarizeInsights(json, { startDate, endDate } = {}) {
  const d = json?.data?.xigTextAppViewer?.text_app_account_insights?.data;
  if (!d) return { error: "no insights data", raw: json };

  const eng = (key) => {
    const arr = d.engagement_summary?.[key] || [];
    const m = Object.fromEntries(arr.map((x) => [x.label, x.value]));
    return { all: m.ALL ?? 0, follower: m.FOLLOWER ?? 0, non_follower: m.NON_FOLLOWER ?? 0 };
  };

  const fts = (d.follower_trends?.total_followers || []).map((x) => x.value);
  const trendArr = (arr) => (arr || []).map((x) => x?.value ?? 0);
  const totalViews = trendArr(d.view_trends?.total_view_trends);
  const followerViews = trendArr(d.view_trends?.follower_view_trends);

  return {
    range: { start: startDate, end: endDate, days: fts.length },
    followers: fts.length
      ? { start: fts[0], end: fts[fts.length - 1], delta: fts[fts.length - 1] - fts[0], series: fts }
      : null,
    engagement_30d: {
      views: eng("views"),
      likes: eng("likes"),
      replies: eng("replies"),
      reposts: eng("reposts"),
      quotes: eng("quotes"),
    },
    daily_views: {
      total: { sum: sum(totalViews), max: max(totalViews), series: totalViews },
      from_followers: { sum: sum(followerViews), max: max(followerViews), series: followerViews },
    },
  };
}

const sum = (a) => a.reduce((x, y) => x + (y || 0), 0);
const max = (a) => (a.length ? Math.max(...a) : 0);

/**
 * 投稿別 Insights (web の 3点メニュー → 「インサイト」 と同じ data)
 *
 * 取れる項目:
 *   - 表示回数 (impressions): 合計 / フォロワー / 経路別 (feed/profile/activity/permalink/serp/loggedout/fb_tifu/ig_tifu)
 *   - エンゲージメント: like/reply/repost/quote count
 *   - num_media_follows (この投稿経由のフォロー数)
 *
 * @param {object} opts
 * @param {string} opts.accountName  投稿の所有者 (cookies)
 * @param {string|number} opts.postID  投稿の pk (numeric)
 */
export async function getPostInsights({ accountName, postID } = {}) {
  if (!postID) throw new Error("postID required");
  return await callGraphQL({
    accountName,
    friendlyName: "BarcelonaPostInsightsDialogQuery",
    variables: { postID: String(postID) },
    referer: "https://www.threads.com/",
    crn: "comet.threads.BarcelonaPostColumnRoute",
    endpoint: "https://www.threads.com/graphql/query",
  });
}

export function summarizePostInsights(json) {
  const m = json?.data?.media;
  if (!m) return { error: "no data", raw: json };
  const pi = m.text_post_app_info?.post_insights;
  return {
    pk: m.pk || null,
    caption: m.text_post_app_info?.post_preview_caption,
    counts: {
      likes: m.like_count,
      replies: m.text_post_app_info?.direct_reply_count,
      reposts: m.text_post_app_info?.repost_count,
      quotes: m.text_post_app_info?.quote_count,
    },
    impressions: pi?.impressions_breakdown?.total ?? null,
    impressions_from_followers: pi?.impressions_breakdown?.followers ?? null,
    impressions_from_non_followers: pi
      ? (pi.impressions_breakdown.total - pi.impressions_breakdown.followers)
      : null,
    impressions_by_source: pi?.impressions_source_breakdown || null,
    new_follows_from_post: pi?.num_media_follows ?? null,
  };
}
