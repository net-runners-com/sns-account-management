// Threads アクティビティフィード (web GraphQL BarcelonaActivityFeedStoryListContainerQuery)
//
// 自分の投稿に対する like / reply / repost / quote / follow / mention 通知を一覧取得.
// endpoint は /graphql/query (post insights と同じ. /api/graphql では null 返る)
import { callGraphQL } from "./graphql.mjs";

const RELAY_FLAGS = {
  __relay_internal__pv__BarcelonaIsLoggedInrelayprovider: true,
  __relay_internal__pv__BarcelonaHasProfileSelfReplyContextrelayprovider: true,
  __relay_internal__pv__BarcelonaHasDearAlgoConsumptionrelayprovider: true,
  __relay_internal__pv__BarcelonaHasEventBadgerelayprovider: false,
  __relay_internal__pv__BarcelonaIsSearchDiscoveryEnabledrelayprovider: false,
  __relay_internal__pv__BarcelonaHasCommunitiesrelayprovider: true,
  __relay_internal__pv__BarcelonaHasGameScoreSharerelayprovider: true,
  __relay_internal__pv__BarcelonaHasPublicViewCountCardrelayprovider: true,
  __relay_internal__pv__BarcelonaHasCommunityEntityCardrelayprovider: true,
  __relay_internal__pv__BarcelonaHasScorecardCommunityrelayprovider: true,
  __relay_internal__pv__BarcelonaHasMusicrelayprovider: false,
  __relay_internal__pv__BarcelonaHasNewspaperLinkStylerelayprovider: false,
  __relay_internal__pv__BarcelonaHasMessagingrelayprovider: false,
  __relay_internal__pv__BarcelonaHasGhostPostEmojiActivationrelayprovider: false,
  __relay_internal__pv__BarcelonaOptionalCookiesEnabledrelayprovider: true,
  __relay_internal__pv__BarcelonaHasDearAlgoWebProductionrelayprovider: false,
  __relay_internal__pv__BarcelonaIsCrawlerrelayprovider: false,
  __relay_internal__pv__BarcelonaHasCommunityTopContributorsrelayprovider: false,
  __relay_internal__pv__BarcelonaCanSeeSponsoredContentrelayprovider: false,
  __relay_internal__pv__BarcelonaShouldShowFediverseM075Featuresrelayprovider: true,
  __relay_internal__pv__BarcelonaIsInternalUserrelayprovider: false,
  __relay_internal__pv__BarcelonaIsInlineReelsEnabledrelayprovider: true,
  __relay_internal__pv__BarcelonaShowReshareCountrelayprovider: true,
  __relay_internal__pv__BarcelonaQuotedPostUFIEnabledrelayprovider: false,
};

/**
 * アクティビティフィード取得
 * @param {object} opts
 * @param {string} opts.accountName
 * @param {number} [opts.first]  取得件数 (default 30)
 */
export async function getActivityFeed({ accountName, first = 30 } = {}) {
  return await callGraphQL({
    accountName,
    friendlyName: "BarcelonaActivityFeedStoryListContainerQuery",
    variables: { first, ...RELAY_FLAGS },
    referer: "https://www.threads.com/activity",
    crn: "comet.threads.BarcelonaActivityFeedColumnRoute",
    endpoint: "https://www.threads.com/graphql/query",
  });
}

/**
 * inbox を「既読」マーク (アプリで開いた状態にする = 通知バッジクリア)
 */
export async function markActivityAsSeen({ accountName } = {}) {
  return await callGraphQL({
    accountName,
    friendlyName: "BarcelonaActivityFeedMarkInboxAsSeenMutation",
    variables: {},
    referer: "https://www.threads.com/activity",
    crn: "comet.threads.BarcelonaActivityFeedColumnRoute",
    endpoint: "https://www.threads.com/graphql/query",
  });
}

// 既知 story_type マッピング (icon_name + content から推定)
function classifyStoryType({ story_type, icon_name, context }) {
  if (icon_name === "like") return "like";
  if (icon_name === "comment" || icon_name === "reply") return "reply";
  if (icon_name === "share" || icon_name === "repost") return "repost";
  if (icon_name === "user" || icon_name === "profile") return "follow_or_recommend";
  // context (subtitle) から類推
  if (/フォローしました|started following|followed you/.test(context || "")) return "follow";
  if (/フォロー中(で|の人)|following/.test(context || "")) return "following_post";
  if (/おすすめ|suggested|recommended/.test(context || "")) return "recommend";
  if (/メンション|mentioned/.test(context || "")) return "mention";
  if (/quote|引用/.test(context || "")) return "quote";
  return `story_${story_type}`;
}

export function summarizeActivity(json) {
  const edges = json?.data?.notifications?.edges || [];
  return edges.map((e) => {
    const a = e.node?.args || {};
    const ex = a.extra || {};
    const story_type = e.node?.story_type;
    const dest_match = (a.destination || "").match(/media\?id=(\d+)_\d+&shortcode=([A-Za-z0-9_-]+)/);
    const profile_dest = a.profile_image_destination || "";
    return {
      type: classifyStoryType({ story_type, icon_name: ex.icon_name, context: ex.context }),
      story_type,
      icon_name: ex.icon_name,
      from_username: a.profile_name,
      from_user_id: profile_dest.match(/id=(\d+)/)?.[1] || null,
      timestamp: a.timestamp ? new Date(a.timestamp * 1000).toISOString() : null,
      target_post_pk: dest_match?.[1] || null,
      target_post_code: dest_match?.[2] || null,
      content_preview: ex.context?.replace(/\n/g, " ").slice(0, 80),
      raw_destination: a.destination,
    };
  });
}
