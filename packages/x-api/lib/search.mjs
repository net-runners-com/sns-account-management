// X (Twitter) 検索 GraphQL ラッパー
// SearchTimeline operation を pagination 込みで叩く.
// x-client-transaction-id を npm package で生成 (これが無いと 404 になる).
// session 切れは XSessionError として throw.
import { authHeaders } from "../session.mjs";
import { xFetch } from "./http.mjs";
import { ClientTransaction, handleXMigration } from "x-client-transaction-id";

const QUERY_ID = "Yw6L66Pw54NHKuq4Dp7b4Q"; // 2026-05 時点 (web bundle 抽出)

// transaction generator は process 内 singleton (X.com の HTML 取得が重い)
let _txGen = null;
async function getTransactionGen() {
  if (_txGen) return _txGen;
  const document = await handleXMigration();
  _txGen = await ClientTransaction.create(document);
  return _txGen;
}

async function generateTransactionId(method, urlPath) {
  const gen = await getTransactionGen();
  return await gen.generateTransactionId(method, urlPath);
}

// 値は実 x.com の working request からそのまま (A/B test 状況で flag が変わるので注意)
const FEATURES = {
  rweb_video_screen_enabled: false,
  rweb_cashtags_enabled: true,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  responsive_web_profile_redirect_enabled: false,
  rweb_tipjar_consumption_enabled: false,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  premium_content_api_read_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  responsive_web_grok_analyze_button_fetch_trends_enabled: false,
  responsive_web_grok_analyze_post_followups_enabled: true,
  rweb_cashtags_composer_attachment_enabled: true,
  responsive_web_jetfuel_frame: true,
  responsive_web_grok_share_attachment_enabled: true,
  responsive_web_grok_annotations_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  rweb_conversational_replies_downvote_enabled: false,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  content_disclosure_indicator_enabled: true,
  content_disclosure_ai_generated_indicator_enabled: true,
  responsive_web_grok_show_grok_translated_post: true,
  responsive_web_grok_analysis_button_from_backend: true,
  post_ctas_fetch_enabled: true,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: false,
  responsive_web_grok_image_annotation_enabled: true,
  responsive_web_grok_imagine_annotation_enabled: true,
  responsive_web_grok_community_note_auto_translation_is_enabled: true,
  responsive_web_enhance_cards_enabled: false,
};

/**
 * @param {string} product "Top" | "Latest" | "People" | "Photos" | "Videos"
 */
export async function fetchSearchPage(acc, { rawQuery, cursor, count = 20, product = "Top", accountName } = {}) {
  if (!rawQuery) throw new Error("rawQuery required");
  const variables = {
    rawQuery,
    count,
    querySource: "typed_query",
    product,
    withGrokTranslatedBio: true,
  };
  if (cursor) variables.cursor = cursor;
  const path = `/i/api/graphql/${QUERY_ID}/SearchTimeline`;
  const url = `https://x.com${path}?variables=${encodeURIComponent(
    JSON.stringify(variables)
  )}&features=${encodeURIComponent(JSON.stringify(FEATURES))}`;
  const tid = await generateTransactionId("GET", path);
  const r = await xFetch(
    url,
    {
      headers: {
        ...authHeaders(acc, { json: true, referer: `https://x.com/search?q=${encodeURIComponent(rawQuery)}&src=typed_query&f=top` }),
        "x-client-transaction-id": tid,
      },
    },
    { accountName }
  );
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${(r.text || JSON.stringify(r.json) || "").slice(0, 300)}`);
  return r.json;
}

/**
 * timeline instructions から tweet/user/cursor 抽出
 */
export function extractFromTimeline(json) {
  const tweets = [];
  const users = [];
  let bottomCursor = null;
  const insns =
    json?.data?.search_by_raw_query?.search_timeline?.timeline?.instructions ||
    json?.data?.timeline?.timeline?.instructions ||
    [];
  for (const ins of insns) {
    for (const e of ins.entries || []) {
      const c = e.content || {};
      if (c.entryType === "TimelineTimelineCursor" && c.cursorType === "Bottom") {
        bottomCursor = c.value;
      }
      if (c.entryType === "TimelineTimelineItem") {
        const tw = extractTweetCore(c.itemContent);
        if (tw) tweets.push(tw);
        const u = extractUserCore(c.itemContent);
        if (u) users.push(u);
      }
      if (c.entryType === "TimelineTimelineModule") {
        for (const item of c.items || []) {
          const tw = extractTweetCore(item.item?.itemContent);
          if (tw) tweets.push(tw);
          const u = extractUserCore(item.item?.itemContent);
          if (u) users.push(u);
        }
      }
    }
  }
  return { tweets, users, bottomCursor };
}

function extractTweetCore(itemContent) {
  if (!itemContent || itemContent.itemType !== "TimelineTweet") return null;
  const tr = itemContent.tweet_results?.result;
  if (!tr || tr.__typename === "TweetTombstone") return null;
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
    in_reply_to_user_id: legacy.in_reply_to_user_id_str || null,
    in_reply_to_screen_name: legacy.in_reply_to_screen_name || null,
    is_retweet: !!legacy.retweeted_status_result || /^RT @/.test(fullText),
    is_quote: !!legacy.is_quote_status,
    favorite_count: legacy.favorite_count ?? 0,
    reply_count: legacy.reply_count ?? 0,
    retweet_count: legacy.retweet_count ?? 0,
    quote_count: legacy.quote_count ?? 0,
    bookmark_count: legacy.bookmark_count ?? 0,
    view_count: Number(t.views?.count ?? 0) || 0,
    media: (legacy.entities?.media || []).map((m) => ({
      type: m.type,
      url: m.media_url_https,
    })),
    hashtags: (legacy.entities?.hashtags || []).map((h) => h.text),
    user: {
      id: core?.rest_id || userLegacy.id_str,
      screen_name: userCore.screen_name || userLegacy.screen_name,
      name: userCore.name || userLegacy.name,
      followers_count: userLegacy.followers_count,
      following_count: userLegacy.friends_count,
      verified: !!core?.verification?.verified || !!userLegacy.verified,
      is_blue_verified: !!core?.is_blue_verified,
      profile_image_url: userLegacy.profile_image_url_https?.replace("_normal", "_400x400"),
    },
  };
}

function extractUserCore(itemContent) {
  if (!itemContent || itemContent.itemType !== "TimelineUser") return null;
  const ur = itemContent.user_results?.result;
  if (!ur) return null;
  const legacy = ur.legacy || {};
  const core = ur.core || {};
  return {
    id: ur.rest_id,
    screen_name: core.screen_name || legacy.screen_name,
    name: core.name || legacy.name,
    followers_count: legacy.followers_count,
    following_count: legacy.friends_count,
    description: legacy.description || "",
    verified: !!ur.verification?.verified || !!legacy.verified,
    is_blue_verified: !!ur.is_blue_verified,
    profile_image_url: legacy.profile_image_url_https?.replace("_normal", "_400x400"),
  };
}

/**
 * pagination 全部追跡して count 件まで集める.
 * product=People の場合は users が、Top/Latest 等は tweets が対象.
 */
export async function searchAll(
  acc,
  { rawQuery, max = 100, perPage = 20, product = "Top", accountName, onPage } = {}
) {
  const isPeople = product === "People";
  const allTweets = [];
  const allUsers = [];
  const tweetIds = new Set();
  const userIds = new Set();
  let cursor = null;
  let prevCursor = null;
  let pageNo = 0;
  while ((isPeople ? allUsers.length : allTweets.length) < max) {
    pageNo++;
    const json = await fetchSearchPage(acc, {
      rawQuery,
      cursor,
      count: Math.min(perPage, max - (isPeople ? allUsers.length : allTweets.length)),
      product,
      accountName,
    });
    const { tweets, users, bottomCursor } = extractFromTimeline(json);
    let newTweets = 0, newUsers = 0;
    for (const t of tweets) if (t.id && !tweetIds.has(t.id)) { tweetIds.add(t.id); allTweets.push(t); newTweets++; }
    for (const u of users) if (u.id && !userIds.has(u.id)) { userIds.add(u.id); allUsers.push(u); newUsers++; }
    const newThisPage = isPeople ? newUsers : newTweets;
    if (onPage) {
      onPage({
        pageNo,
        tweets: newTweets,
        users: newUsers,
        total: isPeople ? allUsers.length : allTweets.length,
        cursor: bottomCursor,
      });
    }
    // 新規 0 / cursor 変化なし / cursor 無し → 終了
    if (!bottomCursor || newThisPage === 0 || bottomCursor === prevCursor) break;
    prevCursor = cursor;
    cursor = bottomCursor;
    await new Promise((r) => setTimeout(r, 500 + Math.random() * 500));
  }
  return {
    tweets: isPeople ? allTweets : allTweets.slice(0, max),
    users: isPeople ? allUsers.slice(0, max) : allUsers,
  };
}
