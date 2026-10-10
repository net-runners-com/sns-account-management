// Threads アカウント検索 (useBarcelonaAccountSearchGraphQLDataSourceQuery)
//
// 目的: 検索バーの「アカウント」タブ相当の query を発行し、ユーザー一覧を取得.
// シャドウバン検知の検索可視性チェックに使う.
//
// 注意: callGraphQL (tlsFetch 経由) では server が null を返す bug あり.
//       global fetch + 最小ヘッダで直接叩く実装.
import { getAccount } from "../session.mjs";
import { computeJazoest } from "./encryption.mjs";

const GRAPHQL_URL = "https://www.threads.com/graphql/query";
const DOC_ID = "26405397225812196";

async function fetchHomeTokens(acc) {
  const r = await fetch("https://www.threads.com/", {
    headers: {
      Cookie: acc.cookies,
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
    },
  });
  const html = await r.text();
  return {
    fb_dtsg: (html.match(/"DTSGInitialData"[^{]*\{"token":"([^"]+)"/) || [])[1],
    lsd: (html.match(/"LSD"[^{]*\{"token":"([^"]+)"/) || [])[1],
    av: (html.match(/"actorID":"(\d+)"/) || [])[1] || "0",
  };
}

/**
 * username (またはキーワード) でユーザー検索
 *
 * @param {object} opts
 * @param {string} opts.accountName  検索を実行するアカウント
 * @param {string} opts.query        検索クエリ
 * @param {number} [opts.first]      返す上限 (default 10)
 * @returns {Promise<{users: Array, raw}>}
 */
export async function searchUsers({ accountName, query, first = 10 } = {}) {
  if (!accountName) throw new Error("accountName required");
  if (!query) throw new Error("query required");
  const acc = getAccount(accountName);
  if (!acc.cookies) throw new Error(`account "${accountName}" cookies missing`);

  const tokens = await fetchHomeTokens(acc);
  if (!tokens.fb_dtsg || !tokens.lsd) throw new Error("fb_dtsg / lsd 取得失敗");

  const variables = {
    query,
    first,
    should_fetch_ig_inactive_on_text_app: null,
    should_fetch_friendship_status: false,
    should_fetch_fediverse_profiles: true,
    hide_unconnected_private: false,
    __relay_internal__pv__BarcelonaIsLoggedInrelayprovider: true,
    __relay_internal__pv__BarcelonaIsCrawlerrelayprovider: false,
  };

  const body = new URLSearchParams({
    av: tokens.av,
    fb_dtsg: tokens.fb_dtsg,
    lsd: tokens.lsd,
    jazoest: computeJazoest(tokens.fb_dtsg),
    fb_api_caller_class: "RelayModern",
    fb_api_req_friendly_name: "useBarcelonaAccountSearchGraphQLDataSourceQuery",
    server_timestamps: "true",
    variables: JSON.stringify(variables),
    doc_id: DOC_ID,
  }).toString();

  // ★ tlsFetch 経由だと server が null 返す. global fetch 使う
  const r = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-CSRFToken": acc.csrftoken,
      "X-IG-App-ID": "238260118697367",
      "X-FB-Friendly-Name": "useBarcelonaAccountSearchGraphQLDataSourceQuery",
      "X-Root-Field-Name": "xdt_api__v1__users__search_connection",
      Cookie: acc.cookies,
      Origin: "https://www.threads.com",
      Referer: "https://www.threads.com/search",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
    },
    body,
  });
  const json = await r.json().catch(() => ({}));

  // edges[].node から user 抽出
  const edges = json?.data?.xdt_api__v1__users__search_connection?.edges || [];
  const users = edges.map((e) => {
    const n = e.node || e;
    return {
      pk: String(n.pk || n.id || ""),
      username: n.username || null,
      full_name: n.full_name || null,
      is_verified: !!n.is_verified,
      is_private: !!n.text_post_app_is_private || !!n.is_private,
      profile_pic_url: n.profile_pic_url || null,
      follower_count: n.follower_count ?? null,
      friendship_status: n.friendship_status || null,
    };
  });

  return { users, raw: json };
}

/**
 * 指定 username が検索結果に出るかだけ確認 (boolean)
 */
export async function isUsernameSearchable({ accountName, username, first = 10 } = {}) {
  const { users } = await searchUsers({ accountName, query: username, first });
  const target = String(username).replace(/^@/, "").toLowerCase();
  return users.some((u) => String(u.username).toLowerCase() === target);
}
