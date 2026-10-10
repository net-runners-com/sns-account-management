// X user posts (UserTweets / UserTweetsAndReplies / UserMedia / Likes) GraphQL ラッパー
// pagination 完全対応 (cursor 自動追跡). session 切れは XSessionError throw.
import { authHeaders } from "../session.mjs";
import { xFetch } from "./http.mjs";

// queryId は web ビルドごとに rotate するが、安定して動くものを記録
const QUERY_IDS = {
  UserTweets: "E3opETHurmVJflFsUBVuUQ",
  // 必要時に増やす:
  // UserTweetsAndReplies: "...",
  // UserMedia: "...",
  // Likes: "...",
};

const BASE_FEATURES = {
  profile_label_improvements_pcf_label_in_post_enabled: true,
  rweb_tipjar_consumption_enabled: true,
  responsive_web_graphql_exclude_directive_enabled: true,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  premium_content_api_read_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  responsive_web_grok_analyze_button_fetch_trends_enabled: false,
  responsive_web_grok_analyze_post_followups_enabled: true,
  responsive_web_jetfuel_frame: false,
  responsive_web_grok_share_attachment_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  tweet_awards_web_tipping_enabled: false,
  creator_subscriptions_quote_tweet_preview_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  rweb_video_timestamps_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  responsive_web_enhance_cards_enabled: false,
};

/**
 * 1ページ取得 (cursor 指定で続き)
 */
export async function fetchUserTweetsPage(acc, { userId, cursor, count = 40, queryName = "UserTweets", accountName } = {}) {
  const qid = QUERY_IDS[queryName];
  if (!qid) throw new Error(`unknown queryName: ${queryName}`);
  const variables = {
    userId,
    count,
    includePromotedContent: false,
    withQuickPromoteEligibilityTweetFields: false,
    withVoice: true,
    withV2Timeline: true,
  };
  if (cursor) variables.cursor = cursor;
  const url = `https://api.x.com/graphql/${qid}/${queryName}?variables=${encodeURIComponent(
    JSON.stringify(variables)
  )}&features=${encodeURIComponent(JSON.stringify(BASE_FEATURES))}`;
  const r = await xFetch(
    url,
    { headers: authHeaders(acc, { json: false }) },
    {
      accountName,
      rebuildHeaders: (newAcc) => ({ headers: authHeaders(newAcc, { json: false }) }),
    }
  );
  if (!r.ok) {
    throw new Error(`HTTP ${r.status}: ${(r.text || JSON.stringify(r.json) || "").slice(0, 300)}`);
  }
  return r.json;
}

/**
 * timeline instructions から tweet entries と cursor を抽出
 */
export function extractTweetsAndCursor(json) {
  const tweets = [];
  let bottomCursor = null;
  const instructions =
    json?.data?.user?.result?.timeline_v2?.timeline?.instructions ||
    json?.data?.user?.result?.timeline?.timeline?.instructions ||
    [];
  for (const ins of instructions) {
    const entries = ins.entries || [];
    for (const e of entries) {
      const c = e.content || {};
      if (c.entryType === "TimelineTimelineCursor" && c.cursorType === "Bottom") {
        bottomCursor = c.value;
      }
      if (c.entryType === "TimelineTimelineItem") {
        const tw = extractTweetCore(c.itemContent);
        if (tw) tweets.push(tw);
      }
      if (c.entryType === "TimelineTimelineModule") {
        for (const item of c.items || []) {
          const tw = extractTweetCore(item.item?.itemContent);
          if (tw) tweets.push(tw);
        }
      }
    }
    if (ins.type === "TimelineReplaceEntry" && ins.entry?.content?.cursorType === "Bottom") {
      bottomCursor = ins.entry.content.value;
    }
  }
  return { tweets, bottomCursor };
}

function extractTweetCore(itemContent) {
  if (!itemContent || itemContent.itemType !== "TimelineTweet") return null;
  const tr = itemContent.tweet_results?.result;
  if (!tr) return null;
  // promoted や restricted は skip
  if (tr.__typename === "TweetTombstone") return null;
  const t = tr.tweet || tr;
  const legacy = t.legacy || {};
  const core = t.core?.user_results?.result;
  const userLegacy = core?.legacy || {};
  const userCore = core?.core || {};
  const noteText = t.note_tweet?.note_tweet_results?.result?.text;
  const fullText = noteText || legacy.full_text || "";
  return {
    id: t.rest_id || legacy.id_str,
    created_at: legacy.created_at,
    text: fullText,
    is_long: !!noteText,
    lang: legacy.lang,
    is_reply: !!legacy.in_reply_to_status_id_str,
    in_reply_to_status_id: legacy.in_reply_to_status_id_str || null,
    in_reply_to_screen_name: legacy.in_reply_to_screen_name || null,
    is_retweet: !!legacy.retweeted_status_result || /^RT @/.test(fullText),
    is_quote: !!legacy.is_quote_status,
    quoted_id: legacy.quoted_status_id_str || null,
    favorite_count: legacy.favorite_count ?? 0,
    reply_count: legacy.reply_count ?? 0,
    retweet_count: legacy.retweet_count ?? 0,
    quote_count: legacy.quote_count ?? 0,
    bookmark_count: legacy.bookmark_count ?? 0,
    view_count: Number(t.views?.count ?? 0) || 0,
    media: (legacy.entities?.media || []).map((m) => ({
      type: m.type,
      url: m.media_url_https,
      display_url: m.display_url,
    })),
    urls: (legacy.entities?.urls || []).map((u) => ({
      url: u.url,
      expanded: u.expanded_url,
      display: u.display_url,
    })),
    hashtags: (legacy.entities?.hashtags || []).map((h) => h.text),
    user: {
      id: core?.rest_id || userLegacy.id_str,
      screen_name: userCore.screen_name || userLegacy.screen_name,
      name: userCore.name || userLegacy.name,
    },
  };
}

/**
 * 全 tweet を pagination 完了するまで取得
 */
export async function getAllUserTweets(
  acc,
  { userId, max = Infinity, perPage = 40, queryName = "UserTweets", accountName, onPage } = {}
) {
  const all = [];
  let cursor = null;
  let pageNo = 0;
  while (all.length < max) {
    pageNo++;
    const json = await fetchUserTweetsPage(acc, {
      userId,
      cursor,
      count: Math.min(perPage, max - all.length),
      queryName,
      accountName,
    });
    const { tweets, bottomCursor } = extractTweetsAndCursor(json);
    all.push(...tweets);
    if (onPage) onPage({ pageNo, count: tweets.length, total: all.length, cursor: bottomCursor });
    if (!bottomCursor || tweets.length === 0) break;
    cursor = bottomCursor;
    // jitter + rate-limit 配慮
    await new Promise((r) => setTimeout(r, 400 + Math.random() * 400));
  }
  return all.slice(0, max);
}
