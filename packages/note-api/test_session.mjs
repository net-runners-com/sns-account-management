// セッション動作確認: accounts.json の cookies で API を叩いて生きてるか確認
//
//   node test_session.mjs                  → personal_dev
//   node test_session.mjs hirotodev0622    → 指定アカウント
import { getClientAs } from "./session.mjs";

const accountName = process.argv[2] || "personal_dev";
const client = await getClientAs(accountName);

// 1) 検索: 認証不要だが疎通確認
const search = await client.searchNotes?.({ q: "ADHD", size: 3 }).catch(e => ({ error: e?.message || String(e) }));
console.log(`[test] searchNotes:`, search?.error || `ok (${search?.data?.notes?.length ?? "?"} hits)`);

// 2) 自分のPV統計: cookieが有効でないと取れない
try {
  const { getStatsPv } = await import("./lib/index.mjs");
  const r = await getStatsPv(client, { filter: "all", page: 1, sort: "pv" });
  console.log(`[test] getStatsPv: ok  total_pv=${r?.data?.total_pv ?? "?"}  notes=${r?.data?.note_stats?.length ?? "?"}`);
  const top = r?.data?.note_stats?.[0];
  if (top) console.log(`[test] top: ${top.read_count} pv — ${top.name}`);
} catch (e) {
  console.error(`[test] getStatsPv FAILED: ${e?.message || e}`);
  process.exit(1);
}
