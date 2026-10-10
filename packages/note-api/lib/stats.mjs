// ダッシュボード分析: 自分の記事ごとのPV/コメント数/スキ数等
//
// GET /api/v1/stats/pv
//   filter: "all" | (詳細未確認: "published" / "draft" 等？)
//   sort:   "pv" | "comments" | "likes" | "publish_at" 等
//   page:   1〜
//
// 注意: 自分の記事の統計のみ取得可能（他人の記事のPVは見えない）

import { authHeaders } from "./auth.mjs";

export async function getStatsPv(client, { filter = "all", page = 1, sort = "pv" } = {}) {
  const qs = new URLSearchParams({ filter, page: String(page), sort });
  const res = await fetch(`https://note.com/api/v1/stats/pv?${qs}`, {
    headers: authHeaders(client, { referer: "https://note.com/sitesettings/stats", origin: "https://note.com" }),
  });
  if (!res.ok) throw new Error(`getStatsPv failed ${res.status}: ${await res.text()}`);
  return (await res.json());
}

// 購入者一覧（売上履歴）: GET /api/v1/stats/purchasers
//   返却: { purchasers: [{ price, purchased_at, is_refund, content: {name, key}, user: {urlname, nickname} }], last_page }
export async function getPurchasers(client, { page = 1 } = {}) {
  const res = await fetch(`https://note.com/api/v1/stats/purchasers?page=${page}`, {
    headers: authHeaders(client, { referer: "https://note.com/sitesettings/purchasers", origin: "https://note.com" }),
  });
  if (!res.ok) throw new Error(`getPurchasers failed ${res.status}: ${await res.text()}`);
  return (await res.json());
}

// 全ページ取得（購入者）
export async function getPurchasersAll(client, { maxPages = 50 } = {}) {
  const all = [];
  for (let page = 1; page <= maxPages; page++) {
    const r = await getPurchasers(client, { page });
    const arr = r?.data?.purchasers || [];
    all.push(...arr);
    if (r?.data?.last_page || arr.length === 0) break;
  }
  return all;
}

// 全ページ取得
export async function getStatsAll(client, { filter = "all", sort = "pv", maxPages = 20 } = {}) {
  const all = [];
  for (let page = 1; page <= maxPages; page++) {
    const r = await getStatsPv(client, { filter, page, sort });
    const data = r?.data;
    const arr = data?.note_stats || data?.notes || data?.contents || data;
    if (!Array.isArray(arr) || arr.length === 0) break;
    all.push(...arr);
    if (data?.last_page === page || data?.is_last_page) break;
  }
  return all;
}
