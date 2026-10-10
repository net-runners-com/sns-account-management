// X (Twitter) フォロワー / フォロー中 一覧取得 GraphQL ラッパー
// queryId は web bundle 由来 (rotate するので動かなくなったら更新).
// SearchTimeline と同じく x-client-transaction-id 必須.
import { authHeaders } from "../session.mjs";
import { xFetch } from "./http.mjs";
import { ClientTransaction, handleXMigration } from "x-client-transaction-id";

const QUERY_IDS = {
  Followers: "_orfRBQae57vylFPH0Huhg",
  Following: "F42cDX8PDFxkbjjq6JrM2w",
  BlueVerifiedFollowers: "crKOXrAHR3W3aPuKEJG8GA",
};

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

let _txGen = null;
async function getTransactionGen() {
  if (_txGen) return _txGen;
  const document = await handleXMigration();
  _txGen = await ClientTransaction.create(document);
  return _txGen;
}

/**
 * @param {string} kind "Followers" | "Following" | "BlueVerifiedFollowers"
 */
export async function fetchFollowsPage(acc, { userId, kind = "Followers", cursor, count = 20, accountName } = {}) {
  if (!userId) throw new Error("userId required");
  const queryId = QUERY_IDS[kind];
  if (!queryId) throw new Error(`unknown kind: ${kind}`);
  const variables = { userId, count, includePromotedContent: false };
  if (cursor) variables.cursor = cursor;
  const path = `/i/api/graphql/${queryId}/${kind}`;
  const url = `https://x.com${path}?variables=${encodeURIComponent(
    JSON.stringify(variables)
  )}&features=${encodeURIComponent(JSON.stringify(FEATURES))}`;
  const tid = await (await getTransactionGen()).generateTransactionId("GET", path);
  const r = await xFetch(
    url,
    {
      headers: {
        ...authHeaders(acc, { json: true, referer: `https://x.com/i/user/${userId}/${kind === "Following" ? "following" : "verified_followers"}` }),
        "x-client-transaction-id": tid,
      },
    },
    { accountName }
  );
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${(r.text || JSON.stringify(r.json) || "").slice(0, 300)}`);
  return r.json;
}

export function extractUsers(json) {
  const users = [];
  let bottomCursor = null;
  const insns = json?.data?.user?.result?.timeline?.timeline?.instructions || [];
  for (const ins of insns) {
    for (const e of ins.entries || []) {
      const c = e.content || {};
      if (c.entryType === "TimelineTimelineCursor" && c.cursorType === "Bottom") {
        bottomCursor = c.value;
      }
      if (c.entryType === "TimelineTimelineItem" && c.itemContent?.itemType === "TimelineUser") {
        const u = summarizeUser(c.itemContent.user_results?.result);
        if (u) users.push(u);
      }
    }
  }
  return { users, bottomCursor };
}

function summarizeUser(ur) {
  if (!ur) return null;
  const legacy = ur.legacy || {};
  const core = ur.core || {};
  return {
    id: ur.rest_id,
    screen_name: core.screen_name || legacy.screen_name,
    name: core.name || legacy.name,
    description: legacy.description || "",
    followers_count: legacy.followers_count,
    following_count: legacy.friends_count,
    tweets_count: legacy.statuses_count,
    verified: !!ur.verification?.verified || !!legacy.verified,
    is_blue_verified: !!ur.is_blue_verified,
    protected: !!legacy.protected,
    created_at: core.created_at || legacy.created_at,
    profile_image_url: legacy.profile_image_url_https?.replace("_normal", "_400x400"),
    location: legacy.location || "",
  };
}

/**
 * pagination 完了 or max 件まで集める. dedupe + cursor stale 検知付き.
 */
export async function getAllFollows(acc, { userId, kind = "Followers", max = 100, perPage = 20, accountName, onPage } = {}) {
  const all = [];
  const seen = new Set();
  let cursor = null;
  let prevCursor = null;
  let pageNo = 0;
  while (all.length < max) {
    pageNo++;
    const json = await fetchFollowsPage(acc, {
      userId, kind, cursor,
      count: Math.min(perPage, max - all.length),
      accountName,
    });
    const { users, bottomCursor } = extractUsers(json);
    let added = 0;
    for (const u of users) if (u.id && !seen.has(u.id)) { seen.add(u.id); all.push(u); added++; }
    if (onPage) onPage({ pageNo, gotThisPage: users.length, newThisPage: added, total: all.length, cursor: bottomCursor });
    if (!bottomCursor || added === 0 || bottomCursor === prevCursor) break;
    prevCursor = cursor;
    cursor = bottomCursor;
    await new Promise((r) => setTimeout(r, 700 + Math.random() * 700));
  }
  return all.slice(0, max);
}
