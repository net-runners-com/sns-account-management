// プロフィール HTML から投稿一覧 + 公開メトリクスを抽出
//
// Threads は SSR で /@user の HTML に最初の数件 (~12) 投稿を埋め込む.
// 続き (古い投稿) はスクロール時の GraphQL pagination で取れる. これは別途 doc_id 必要.
//
// ここでは HTML scrape で「最新N件」を取る. 全件欲しい場合は profile feed pagination query を
// キャプチャ → ここに足し込み.
import { httpFetch } from "./fingerprint.mjs";
import { browserHeaders } from "./http.mjs";
import { getAccount } from "../session.mjs";
import { callGraphQL } from "./graphql.mjs";

// Relay provider flags for BarcelonaProfileThreadsTabQuery
// (community-tested via outgram package; works for paginated profile feed)
const RELAY_PROVIDER_FLAGS = {
  __relay_internal__pv__BarcelonaIsLoggedInrelayprovider: "true",
  __relay_internal__pv__BarcelonaIsInlineReelsEnabledrelayprovider: "true",
  __relay_internal__pv__BarcelonaOptionalCookiesEnabledrelayprovider: "true",
  __relay_internal__pv__BarcelonaShowReshareCountrelayprovider: "true",
  __relay_internal__pv__BarcelonaQuotedPostUFIEnabledrelayprovider: "false",
  __relay_internal__pv__BarcelonaIsCrawlerrelayprovider: "false",
  __relay_internal__pv__BarcelonaShouldShowFediverseM075Featuresrelayprovider: "false",
};

const RE_PK = /"pk":"(\d+)"/;

/**
 * /@username の HTML から埋め込み JSON を全部抽出して、その中で投稿データを探す
 */
export async function fetchProfileHTML({ username, accountName } = {}) {
  if (!username) throw new Error("username required");
  const acc = accountName ? getAccount(accountName) : null;
  const u = String(username).replace(/^@/, "");
  const r = await httpFetch(`https://www.threads.com/@${u}`, {
    headers: browserHeaders({
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      ...(acc?.cookies ? { Cookie: acc.cookies } : {}),
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-User": "?1",
      "Upgrade-Insecure-Requests": "1",
    }),
    redirect: "manual",
  });
  if (r.status !== 200) throw new Error(`profile HTML fetch failed: HTTP ${r.status}`);
  return await r.text();
}

/**
 * HTML から script 内の JSON を全部抽出して投稿だけフィルタ.
 * Threads SSR は <script type="application/json" data-sjs>...</script> に
 * Relay store のスナップショットを大量に埋め込む.
 */
export function extractPostsFromHTML(html) {
  const posts = new Map(); // pk → post data (重複排除)
  const re = /<script[^>]+type="application\/json"[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) {
    let raw = m[1];
    // CDATA / 一般 escape 処理
    raw = raw.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    let obj;
    try { obj = JSON.parse(raw); } catch { continue; }
    walkAndCollect(obj, posts);
  }
  return [...posts.values()];
}

function walkAndCollect(o, posts, depth = 0) {
  if (depth > 30 || o == null) return;
  if (Array.isArray(o)) { for (const x of o) walkAndCollect(x, posts, depth + 1); return; }
  if (typeof o !== "object") return;
  // 投稿らしい構造を判定: pk + (caption or like_count or text_post_app_info) を持つ
  if (typeof o.pk === "string" && /^\d+$/.test(o.pk)) {
    const looksLikePost =
      "like_count" in o || "text_post_app_info" in o || "caption" in o ||
      "code" in o || ("__typename" in o && /XDTMedia|Media/i.test(o.__typename || ""));
    if (looksLikePost && !posts.has(o.pk)) {
      posts.set(o.pk, summarizePost(o));
    }
  }
  for (const k of Object.keys(o)) walkAndCollect(o[k], posts, depth + 1);
}

function summarizePost(p) {
  const captionText = p.caption?.text || p.text_post_app_info?.text_with_entities?.text || null;
  return {
    pk: p.pk,
    code: p.code || null,
    taken_at: p.taken_at || p.device_timestamp || null,
    text: captionText,
    counts: {
      likes: p.like_count ?? null,
      replies: p.text_post_app_info?.direct_reply_count ?? null,
      reposts: p.text_post_app_info?.repost_count ?? null,
      quotes: p.text_post_app_info?.quote_count ?? null,
      views: p.feedback_info?.aggregated_like_count ?? null,
      shares: p.share_count ?? null,
    },
    media_type: p.media_type ?? null,
    has_media: !!(p.image_versions2?.candidates?.length || p.video_versions?.length),
    is_pinned: p.text_post_app_info?.is_post_pinned ?? null,
    user: p.user ? { pk: p.user.pk, username: p.user.username } : null,
    url: p.code && p.user?.username ? `https://www.threads.com/@${p.user.username}/post/${p.code}` : null,
  };
}

/**
 * username からプロフィール最新投稿一覧 (HTML scrape, ~5 件)
 */
export async function getUserPosts({ username, accountName } = {}) {
  const html = await fetchProfileHTML({ username, accountName });
  return extractPostsFromHTML(html);
}

/**
 * HTML から userID と end_cursor を抜く
 */
function extractInitialPaginationState(html) {
  const userID = html.match(/"user_id":"(\d+)"/)?.[1] || html.match(/"userID":"(\d+)"/)?.[1] || null;
  const end_cursor = html.match(/"end_cursor":"([^"]+)"/)?.[1] || null;
  const has_next_page = html.match(/"has_next_page":(true|false)/)?.[1] === "true";
  return { userID, end_cursor, has_next_page };
}

/**
 * 全投稿 pagination で取得 (HTML scrape + GraphQL 連続 call)
 *
 * @param {object} opts
 * @param {string} opts.username      対象ユーザー名 (@抜き)
 * @param {string} opts.accountName   ログイン中アカウント (cookies 必要)
 * @param {number} [opts.first]       1 ページ件数 (default 25)
 * @param {number} [opts.maxPages]    最大ページ数 (default 50 = 1250 投稿目安)
 * @param {function} [opts.onPage]    {page, posts, totalPosts, hasNext} を受け取る
 */
export async function getAllUserPosts({ username, accountName, first = 25, maxPages = 50, onPage } = {}) {
  if (!accountName) throw new Error("accountName required (need login cookies)");

  // 1. HTML 取って userID + 初期 cursor + 初回 posts 抽出
  const html = await fetchProfileHTML({ username, accountName });
  const { userID, end_cursor: initialCursor, has_next_page: initialHasNext } = extractInitialPaginationState(html);
  if (!userID) throw new Error(`could not extract userID from profile HTML for @${username}`);

  const allPosts = new Map();
  for (const p of extractPostsFromHTML(html)) {
    if (p.user?.username?.toLowerCase() === String(username).replace(/^@/, "").toLowerCase()) {
      allPosts.set(p.pk, p);
    }
  }
  if (onPage) onPage({ page: 0, posts: allPosts.size, totalPosts: allPosts.size, hasNext: initialHasNext });

  // 2. cursor 回す (BarcelonaProfileThreadsTabQuery — pagination 対応)
  let cursor = initialCursor;
  let hasNext = initialHasNext;
  let pageNum = 0;
  while (hasNext && pageNum < maxPages) {
    pageNum++;
    const variables = {
      userID,
      ...(cursor ? { after: cursor, first } : {}),
      ...RELAY_PROVIDER_FLAGS,
    };
    const r = await callGraphQL({
      accountName,
      friendlyName: "BarcelonaProfileThreadsTabQuery",
      variables,
      referer: `https://www.threads.com/@${String(username).replace(/^@/, "")}`,
      crn: "comet.threads.BarcelonaProfileThreadsColumnRoute",
    });
    if (r.json?.errors) throw new Error(`GraphQL error: ${JSON.stringify(r.json.errors).slice(0, 300)}`);

    const before = allPosts.size;
    walkAndCollect(r.json, allPosts);
    // ↓ user filter (他人の thread が混入する場合があるので)
    for (const [k, p] of allPosts) {
      const u = p.user?.username?.toLowerCase();
      if (u && u !== String(username).replace(/^@/, "").toLowerCase()) {
        // 自分以外の post も集計用に残しておく (replies 含む)
        // ここでは消さない方針 — UI 表示で分岐させる
      }
    }
    const added = allPosts.size - before;

    // 次の cursor / has_next_page 抽出 (response の page_info から)
    const respJson = JSON.stringify(r.json);
    const newCursor = respJson.match(/"end_cursor":"([^"]+)"/)?.[1] || null;
    const newHasNext = respJson.match(/"has_next_page":(true|false)/)?.[1] === "true";
    if (onPage) onPage({ page: pageNum, posts: added, totalPosts: allPosts.size, hasNext: newHasNext });

    if (!newHasNext || !newCursor || added === 0) break;
    cursor = newCursor;
    hasNext = newHasNext;
  }

  return [...allPosts.values()].sort((a, b) => Number(b.pk) - Number(a.pk));
}

