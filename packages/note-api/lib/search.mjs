// 検索: GET /api/v3/searches
//   q:        検索キーワード
//   context:  "note" | "user" | "magazine" | "hashtag" | "circle" | "noteForSale"
//   sort:     "" (デフォルト) | "popular" 等（要検証）
//   size:     1ページあたり件数 (max 20くらい)
//   start:    ページ開始インデックス
//
// 返り値: { contents (notes/users 等), totalCount, isLastPage, cursor }

import { authHeaders } from "./auth.mjs";

const ZERO_CURSOR = JSON.stringify({
  note: "initial", magazine: "initial", user: "initial",
  hashtag: "initial", circle: "initial", noteForSale: "initial",
});

export async function search(client, { q, context = "note", size = 20, start = 0, sort = "" } = {}) {
  if (!q) throw new Error("q は必須");
  // start に応じて該当 context のカーソル値を更新
  const cursor = JSON.parse(ZERO_CURSOR);
  if (cursor[context] !== undefined) cursor[context] = String(start);

  const qs = new URLSearchParams({
    context, q, mode: "search",
    start: String(start), size: String(size),
    cursor: JSON.stringify(cursor), sort,
  });

  const res = await fetch(`https://note.com/api/v3/searches?${qs}`, {
    headers: authHeaders(client, { referer: `https://note.com/search?q=${encodeURIComponent(q)}&context=${context}&mode=search`, origin: "https://note.com" }),
  });
  if (!res.ok) throw new Error(`search failed ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const data = json?.data || json;
  // context 別にレスポンスフィールド名が異なる
  const fieldMap = {
    note: "notes", user: "users", magazine: "magazines",
    hashtag: "hashtags", circle: "circles", noteForSale: "noteForSales",
  };
  const field = fieldMap[context] || context;
  const arr = data?.[field]?.contents || data?.[field] || [];
  const isLastPage = data?.[field]?.isLastPage ?? null;
  const totalCount = data?.[field]?.totalCount ?? arr.length;
  return { items: arr, isLastPage, totalCount, raw: data };
}

// 全ページ取得 (上限ガード付き)
export async function searchAll(client, { q, context = "note", maxPages = 10, size = 20 } = {}) {
  const all = [];
  for (let page = 0; page < maxPages; page++) {
    const r = await search(client, { q, context, size, start: page * size });
    all.push(...r.items);
    if (r.items.length === 0 || r.isLastPage) break;
  }
  return all;
}
