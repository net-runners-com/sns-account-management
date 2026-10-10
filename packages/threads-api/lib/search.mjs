// Threads キーワード検索 (BarcelonaSearchResultsRefetchableQuery 直叩き)
//
// /search?q=<keyword>&serp_type=default の web 通信を再現.
// doc_id 27119638680961657, xdt_api__v1__text_feed__search_results__connection_v2.
// 2026-05-13 動作確認: like_count / reply_count / repost_count / 本文 / pk すべて取れる.
import { callGraphQL } from "./graphql.mjs";

const FRIENDLY = "BarcelonaSearchResultsRefetchableQuery";
const ROOT_FIELD = "xdt_api__v1__text_feed__search_results__connection_v2";
const ENDPOINT = "https://www.threads.com/graphql/query";
const CRN = "comet.threads.BarcelonaSearchResultsColumnRoute";

// Threads web が送ってる relay provider flag セット (2026-05 観測)
const RELAY_PROVIDERS = {
  __relay_internal__pv__BarcelonaHasSERPHeaderrelayprovider: true,
  __relay_internal__pv__BarcelonaHasCommunitiesrelayprovider: true,
  __relay_internal__pv__BarcelonaHasCommunityTopContributorsrelayprovider: false,
  __relay_internal__pv__BarcelonaHasCommunityBobbleheadsrelayprovider: false,
  __relay_internal__pv__BarcelonaIsLoggedInrelayprovider: true,
  __relay_internal__pv__BarcelonaHasDearAlgoConsumptionrelayprovider: true,
  __relay_internal__pv__BarcelonaHasEventBadgerelayprovider: false,
  __relay_internal__pv__BarcelonaIsSearchDiscoveryEnabledrelayprovider: false,
  __relay_internal__pv__BarcelonaHasGameScoreSharerelayprovider: true,
  __relay_internal__pv__BarcelonaHasPublicViewCountCardrelayprovider: true,
  __relay_internal__pv__BarcelonaHasCommunityEntityCardrelayprovider: true,
  __relay_internal__pv__BarcelonaHasScorecardCommunityrelayprovider: true,
  __relay_internal__pv__BarcelonaHasMusicrelayprovider: true,
  __relay_internal__pv__BarcelonaHasNewspaperLinkStylerelayprovider: false,
  __relay_internal__pv__BarcelonaHasMessagingrelayprovider: false,
  __relay_internal__pv__BarcelonaHasGhostPostEmojiActivationrelayprovider: false,
  __relay_internal__pv__BarcelonaOptionalCookiesEnabledrelayprovider: true,
  __relay_internal__pv__BarcelonaHasDearAlgoWebProductionrelayprovider: false,
  __relay_internal__pv__BarcelonaIsCrawlerrelayprovider: false,
  __relay_internal__pv__BarcelonaCanSeeSponsoredContentrelayprovider: false,
  __relay_internal__pv__BarcelonaShouldShowFediverseM075Featuresrelayprovider: true,
  __relay_internal__pv__BarcelonaIsInternalUserrelayprovider: false,
};

function buildVariables({ query, after = null, first = 10, serpType = "default", trendFbid = null }) {
  return {
    after,
    before: null,
    first,
    has_communities: true,
    has_serp_header: true,
    last: null,
    meta_place_id: null,
    pinned_ids: null,
    power_search_info: null,
    query,
    recent: 0,
    search_surface: serpType,
    tagID: null,
    trend_fbid: trendFbid,
    ...RELAY_PROVIDERS,
  };
}

function extractPosts(json) {
  const sr = json?.data?.searchResults;
  if (!sr) return { posts: [], endCursor: null, hasNext: false };
  const posts = [];
  for (const e of sr.edges || []) {
    const ti = e?.node?.thread?.thread_items || [];
    for (const it of ti) {
      const post = it.post;
      if (!post) continue;
      const tpInfo = post.text_post_app_info || {};
      const username = post.user?.username || null;
      posts.push({
        pk: post.pk,
        code: post.code,
        url: post.code && username ? `https://www.threads.com/@${username}/post/${post.code}` : null,
        user: username,
        user_id: post.user?.pk || null,
        full_name: post.user?.full_name || null,
        verified: !!post.user?.is_verified,
        text: post.caption?.text || "",
        taken_at: post.taken_at,
        like_count: post.like_count ?? 0,
        reply_count: tpInfo.direct_reply_count ?? 0,
        repost_count: tpInfo.repost_count ?? 0,
        quote_count: tpInfo.quote_count ?? 0,
        view_count: post.view_count ?? null,
      });
    }
  }
  const pi = sr.page_info || {};
  return { posts, endCursor: pi.end_cursor || null, hasNext: !!pi.has_next_page };
}

/**
 * キーワード検索 (1ページ目). cursor 指定で続きが取れる.
 *
 * @returns {{ posts: Array, endCursor: string|null, hasNext: boolean, raw?: object }}
 */
export async function searchPage({ accountName, query, after = null, first = 10, serpType = "default", trendFbid = null } = {}) {
  if (!accountName) throw new Error("accountName required");
  if (!query) throw new Error("query required");
  const variables = buildVariables({ query, after, first, serpType, trendFbid });
  const r = await callGraphQL({
    accountName,
    friendlyName: FRIENDLY,
    variables,
    referer: `https://www.threads.com/search?q=${encodeURIComponent(query)}&serp_type=${serpType}&hl=ja`,
    crn: CRN,
    rootFieldName: ROOT_FIELD,
    endpoint: ENDPOINT,
  });
  if (r.http !== 200) {
    throw new Error(`HTTP ${r.http}: ${JSON.stringify(r.json).slice(0, 300)}`);
  }
  return { ...extractPosts(r.json), raw: r.json };
}

/**
 * キーワード検索 (pagination 完了 or max 件まで).
 *
 * @param {object} opts
 * @param {string} opts.accountName
 * @param {string} opts.query
 * @param {string} [opts.serpType="default"]   default | trends
 * @param {string|null} [opts.trendFbid]
 * @param {number} [opts.max=Infinity]         取得上限
 * @param {number} [opts.perPage=10]           ページあたり件数 (Threads は 10 上限ぽい)
 * @param {Function} [opts.onPage]             ({ pageNo, count, total, cursor }) => void
 * @param {boolean} [opts.headless]            (互換用、無視される — もう browser 使わない)
 * @param {number} [opts.scrolls]              (互換用、max に変換: scrolls * perPage)
 */
export async function searchThreads({
  accountName, query, serpType = "default", trendFbid = null,
  max = Infinity, perPage = 10, onPage,
  // 旧 API 互換
  headless, scrolls,
} = {}) {
  // 旧 CLI が scrolls=5 を渡してくるので max に変換
  if (scrolls && max === Infinity) max = perPage * scrolls;
  const all = [];
  let after = null;
  let pageNo = 0;
  while (all.length < max) {
    pageNo++;
    const { posts, endCursor, hasNext } = await searchPage({
      accountName, query, after,
      first: Math.min(perPage, max - all.length),
      serpType, trendFbid,
    });
    all.push(...posts);
    if (onPage) onPage({ pageNo, count: posts.length, total: all.length, cursor: endCursor });
    if (!hasNext || posts.length === 0 || !endCursor) break;
    after = endCursor;
    // jitter
    await new Promise((r) => setTimeout(r, 800 + Math.random() * 800));
  }
  return {
    query, serpType, trendFbid,
    url: `https://www.threads.com/search?q=${encodeURIComponent(query)}&serp_type=${serpType}`,
    posts: all.slice(0, max),
    post_ids_seen: all.map((p) => p.pk).filter(Boolean), // 旧 API 互換
  };
}
