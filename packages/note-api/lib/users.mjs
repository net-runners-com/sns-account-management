// ユーザー関連: フォロー / 関連ユーザー / プロフィール取得
//
// userKey: 32 hex のユーザー固有キー（urlname とは別）
//   - 取得方法: getUserByUsername({ urlname })  → data.key
//   - フォロー系APIは userKey を使う、urlname ベースのものは creators/<urlname>/...

import { authHeaders } from "./auth.mjs";

// プロフィール取得（urlname → key 変換にも使える）
export async function getUserByUsername(client, { urlname }) {
  const res = await fetch(`https://note.com/api/v2/creators/${urlname}`, {
    headers: authHeaders(client, { referer: `https://note.com/${urlname}`, origin: "https://note.com" }),
  });
  if (!res.ok) throw new Error(`getUserByUsername failed ${res.status}: ${await res.text()}`);
  return (await res.json()).data;
}

// フォロー: POST /api/v3/users/<userKey>/following
export async function followUser(client, { userKey, urlname }) {
  const ref = urlname ? `https://note.com/${urlname}` : "https://note.com/";
  const res = await fetch(`https://note.com/api/v3/users/${userKey}/following`, {
    method: "POST",
    headers: { ...authHeaders(client, { referer: ref, origin: "https://note.com" }) },
    body: "{}",
  });
  if (!res.ok) throw new Error(`followUser failed ${res.status}: ${await res.text()}`);
  return res.json().catch(() => ({ ok: true }));
}

// アンフォロー: DELETE /api/v3/users/<userKey>/following
export async function unfollowUser(client, { userKey, urlname }) {
  const ref = urlname ? `https://note.com/${urlname}` : "https://note.com/";
  const res = await fetch(`https://note.com/api/v3/users/${userKey}/following`, {
    method: "DELETE",
    headers: authHeaders(client, { referer: ref, origin: "https://note.com" }),
  });
  if (!res.ok) throw new Error(`unfollowUser failed ${res.status}: ${await res.text()}`);
  return res.json().catch(() => ({ ok: true }));
}

// フォロワー一覧: GET /api/v2/creators/<urlname>/followers?page=N
//   返り値: { follows: [...], totalCount, isLastPage }
export async function getFollowers(client, { urlname, page = 1 }) {
  const res = await fetch(`https://note.com/api/v2/creators/${urlname}/followers?page=${page}`, {
    headers: authHeaders(client, { referer: `https://note.com/${urlname}/followers`, origin: "https://note.com" }),
  });
  if (!res.ok) throw new Error(`getFollowers failed ${res.status}: ${await res.text()}`);
  return (await res.json()).data;
}

// フォロー中ユーザー一覧: GET /api/v2/creators/<urlname>/followings?page=N
export async function getFollowings(client, { urlname, page = 1 }) {
  const res = await fetch(`https://note.com/api/v2/creators/${urlname}/followings?page=${page}`, {
    headers: authHeaders(client, { referer: `https://note.com/${urlname}/followings`, origin: "https://note.com" }),
  });
  if (!res.ok) throw new Error(`getFollowings failed ${res.status}: ${await res.text()}`);
  return (await res.json()).data;
}

// 全ページ取得 (kind: "followers" | "followings")
export async function getFollowList(client, { urlname, kind = "followers", maxPages = 100 }) {
  const fetcher = kind === "followings" ? getFollowings : getFollowers;
  const all = [];
  for (let page = 1; page <= maxPages; page++) {
    const r = await fetcher(client, { urlname, page });
    all.push(...(r?.follows || []));
    if (r?.isLastPage || (r?.follows?.length || 0) === 0) break;
  }
  return all;
}

// 関連ユーザー (おすすめユーザー): GET /api/v2/creators/<urlname>/related_users
// 返り値: relatedUsers 配列 [{ urlname, nickname, key, followerCount, isFollowing, ... }]
export async function getRelatedUsers(client, { urlname }) {
  const res = await fetch(`https://note.com/api/v2/creators/${urlname}/related_users`, {
    headers: authHeaders(client, { referer: `https://note.com/${urlname}`, origin: "https://note.com" }),
  });
  if (!res.ok) throw new Error(`getRelatedUsers failed ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json?.data?.relatedUsers || json?.data || [];
}
