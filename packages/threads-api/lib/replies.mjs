// 投稿詳細ページ HTML から「投稿本体 + 返信ツリー」を抽出
//
// Threads は post 詳細ページ (/@user/post/{code}) の SSR HTML に親投稿と返信を
// Relay store snapshot (script application/json data-sjs) として埋め込む.
// 返信専用 GraphQL query は web では発火せず, page-level fetch のみ.
//
// → HTML を 1 発取って extractPostsFromHTML で全 post 抽出 → 親と返信を分離.
import { httpFetch } from "./fingerprint.mjs";
import { browserHeaders } from "./http.mjs";
import { getAccount } from "../session.mjs";
import { extractPostsFromHTML } from "./user_posts.mjs";

/**
 * post URL or {username, code} or {pk} を受けて post 詳細 HTML を取得
 */
async function fetchPostHTML({ username, code, postUrl, accountName }) {
  if (!accountName) throw new Error("accountName required (login cookies)");
  const acc = getAccount(accountName);
  let url;
  if (postUrl) url = postUrl;
  else if (username && code) url = `https://www.threads.com/@${String(username).replace(/^@/, "")}/post/${code}`;
  else throw new Error("postUrl or {username, code} required");

  const r = await httpFetch(url, {
    headers: browserHeaders({
      Cookie: acc.cookies,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-User": "?1",
      "Upgrade-Insecure-Requests": "1",
    }),
    redirect: "manual",
  });
  if (r.status !== 200) throw new Error(`post HTML fetch failed: HTTP ${r.status}`);
  return await r.text();
}

/**
 * post 詳細 HTML から「親投稿 + 返信」を抜き出す.
 *
 * @returns {Promise<{post: object|null, replies: object[], all: object[]}>}
 */
export async function getPostWithReplies({ username, code, postUrl, accountName, postPk } = {}) {
  const html = await fetchPostHTML({ username, code, postUrl, accountName });
  const all = extractPostsFromHTML(html);

  // 親 post を判定:
  //   - URL の code と一致
  //   - もしくは postPk と一致
  //   - もしくは reply_to_author を持たない post で username 一致するもの
  const targetCode = code || (postUrl ? postUrl.match(/\/post\/([A-Za-z0-9_-]+)/)?.[1] : null);
  let post = null;
  if (targetCode) post = all.find((p) => p.code === targetCode) || null;
  if (!post && postPk) post = all.find((p) => p.pk === String(postPk)) || null;
  if (!post && username) {
    const u = String(username).replace(/^@/, "").toLowerCase();
    post = all.find((p) => p.user?.username?.toLowerCase() === u) || null;
  }

  // 返信は親 post 以外の全 post (詳細ページに混入する recommend 系は通常無い)
  const replies = post ? all.filter((p) => p.pk !== post.pk) : [];
  // 古い順 (taken_at 昇順) でソート
  replies.sort((a, b) => (a.taken_at || 0) - (b.taken_at || 0));

  return { post, replies, all };
}
