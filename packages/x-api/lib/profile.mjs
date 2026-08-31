// X user profile 取得 (programmatic API)
// session 切れは XSessionError として throw される.
import { authHeaders } from "../session.mjs";
import { xFetch } from "./http.mjs";

const QUERY_IDS = {
  UserByRestId: "GazOglcBvgLigl3ywt6b3Q",
  UserByScreenName: "Yka-W8dz7RaEuQNkroPkYw",
};

const BASE_FEATURES = {
  hidden_profile_subscriptions_enabled: true,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  rweb_tipjar_consumption_enabled: true,
  responsive_web_graphql_exclude_directive_enabled: true,
  verified_phone_label_enabled: false,
  subscriptions_verification_info_is_identity_verified_enabled: true,
  subscriptions_verification_info_verified_since_enabled: true,
  highlights_tweets_tab_ui_enabled: true,
  responsive_web_twitter_article_notes_tab_enabled: true,
  subscriptions_feature_can_gift_premium: true,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  responsive_web_graphql_timeline_navigation_enabled: true,
};

/**
 * user_id (rest_id) でプロフィール取得
 */
export async function getProfileByRestId(acc, { userId, accountName, raw = false } = {}) {
  if (!userId) throw new Error("userId required");
  const variables = { userId, withSafetyModeUserFields: true };
  const url = `https://api.x.com/graphql/${QUERY_IDS.UserByRestId}/UserByRestId?variables=${encodeURIComponent(
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
  if (raw) return r.json;
  return summarizeProfile(r.json);
}

/**
 * @screen_name でプロフィール取得
 */
export async function getProfileByScreenName(acc, { screenName, accountName, raw = false } = {}) {
  if (!screenName) throw new Error("screenName required");
  const clean = String(screenName).replace(/^@/, "");
  const variables = { screen_name: clean };
  const url = `https://api.x.com/graphql/${QUERY_IDS.UserByScreenName}/UserByScreenName?variables=${encodeURIComponent(
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
  if (raw) return r.json;
  return summarizeProfile(r.json);
}

export function summarizeProfile(json) {
  const u = json?.data?.user?.result;
  if (!u) return null;
  const legacy = u.legacy || {};
  const core = u.core || {};
  const verification = u.verification || {};
  return {
    user_id: u.rest_id || legacy.id_str,
    screen_name: core.screen_name || legacy.screen_name,
    name: core.name || legacy.name,
    is_blue_verified: !!u.is_blue_verified,
    is_verified: !!verification.verified || !!legacy.verified,
    followers_count: legacy.followers_count,
    following_count: legacy.friends_count,
    tweets_count: legacy.statuses_count,
    listed_count: legacy.listed_count,
    favourites_count: legacy.favourites_count,
    media_count: legacy.media_count,
    protected: !!legacy.protected,
    created_at: core.created_at || legacy.created_at,
    description: legacy.description || "",
    location: legacy.location || "",
    url: legacy.entities?.url?.urls?.[0]?.expanded_url || legacy.url || "",
    profile_image_url: legacy.profile_image_url_https?.replace("_normal", "_400x400"),
    profile_banner_url: legacy.profile_banner_url || null,
    pinned_tweet_id: legacy.pinned_tweet_ids_str?.[0] || null,
    can_dm: legacy.can_dm,
    following: !!(u.relationship_perspectives?.following ?? legacy.following),
    followed_by: !!(u.relationship_perspectives?.followed_by ?? legacy.followed_by),
  };
}
