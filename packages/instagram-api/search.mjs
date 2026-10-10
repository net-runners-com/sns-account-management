// Instagram キーワード検索 CLI (pure Node, bridge不要)
//
//   node search.mjs --account <n> <keyword>          # ブレンド検索 (users + hashtags)
//   node search.mjs --account <n> --users <keyword>  # ユーザーのみ
//   node search.mjs --account <n> --tag <hashtag>    # ハッシュタグのトップ投稿 (keyword→投稿)
//   node search.mjs --account <n> --tag <hashtag> --max 60
//   ... --raw で生 JSON
//
// 使う endpoint (RE 実証済み):
//   web/search/topsearch/   — users/hashtags/places
//   fbsearch/account_serp/  — users
//   tags/web_info/          — ハッシュタグ情報 + トップ投稿
//   tags/{tag}/sections/    — ハッシュタグ投稿の pagination
import { igFetch } from "./lib/http.mjs";

const args = process.argv.slice(2);
let accountName = process.env.INSTAGRAM_ACCOUNT || null;
let raw = false, mode = "blended", max = 0;
const positional = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--account") accountName = args[++i];
  else if (a === "--raw") raw = true;
  else if (a === "--users") { mode = "users"; positional.push(args[++i]); }
  else if (a === "--tag") { mode = "tag"; positional.push(args[++i]); }
  else if (a === "--max") max = Number(args[++i]);
  else positional.push(a);
}
const query = positional[0];
if (!accountName || !query) {
  console.error("usage: node search.mjs --account NAME [--users|--tag] [--max N] [--raw] <keyword>");
  process.exit(1);
}
const fmt = (n) => (n ?? 0).toLocaleString("en-US");

// section 構造から media を平坦化
function extractMedias(sections) {
  const out = [];
  for (const s of sections || []) {
    const lc = s.layout_content || {};
    const buckets = [lc.medias, lc.fill_items, lc.one_by_two_item?.clips?.items].filter(Boolean);
    for (const b of buckets) for (const it of b) { const m = it.media || it; if (m?.code) out.push(m); }
  }
  return out;
}
const printMedia = (m) => {
  const d = m.taken_at ? new Date(m.taken_at * 1000).toISOString().slice(0, 16).replace("T", " ") : "?";
  const type = m.media_type === 2 ? "🎬" : (m.carousel_media_count ? `🖼x${m.carousel_media_count}` : "📷");
  const v = m.play_count || m.ig_play_count;
  const cap = (m.caption?.text || "").replace(/\n/g, " ").slice(0, 44);
  console.log(`[${d}] ${type} @${m.user?.username} ❤${fmt(m.like_count)} 💬${fmt(m.comment_count)}${v ? ` ▶${fmt(v)}` : ""} ${cap}`);
  console.log(`   https://www.instagram.com/p/${m.code}/`);
};

if (mode === "tag") {
  const tag = query.replace(/^#/, "");
  const { json } = await igFetch(accountName, `/api/v1/tags/web_info/?tag_name=${encodeURIComponent(tag)}`);
  if (raw && !max) { console.log(JSON.stringify(json, null, 2)); process.exit(0); }
  console.log(`#${tag}  投稿総数 ${fmt(json?.count)}  ${json?.data?.is_trending ? "🔥trending" : ""}`);
  let medias = extractMedias(json?.data?.top?.sections);
  // pagination: tags/{tag}/sections/ (max 指定時)
  let maxId = json?.data?.top?.next_max_id || json?.next_max_id, page = 0;
  while (max && medias.length < max && maxId && page < 10) {
    const body = `include_persistent=true&max_id=${encodeURIComponent(maxId)}&tab=top`;
    const r = await igFetch(accountName, `/api/v1/tags/${encodeURIComponent(tag)}/sections/`, { method: "POST", body });
    const more = extractMedias(r.json?.sections);
    if (!more.length) break;
    medias.push(...more);
    maxId = r.json?.next_max_id; page++;
    process.stderr.write(`\r[tag] page ${page}: total ${medias.length}   `);
    await new Promise(res => setTimeout(res, 700 + Math.random() * 400));
  }
  if (max) { process.stderr.write("\n"); medias = medias.slice(0, max); }
  console.log("─".repeat(70));
  for (const m of medias) printMedia(m);
  console.log(`\n${medias.length} posts`);
  process.exit(0);
}

if (mode === "users") {
  const { json } = await igFetch(accountName, `/api/v1/fbsearch/account_serp/?query=${encodeURIComponent(query)}`);
  if (raw) { console.log(JSON.stringify(json, null, 2)); process.exit(0); }
  console.log(`users for "${query}": ${json?.users?.length || 0}  (follower数は profile.mjs で取得)`);
  console.log("─".repeat(70));
  for (const u of json?.users || []) {
    const fans = u.follower_count ? `  fans=${fmt(u.follower_count)}` : "";
    console.log(`@${u.username}${u.is_verified ? " ✔" : ""}${fans}  ${u.full_name || ""}`);
  }
  process.exit(0);
}

// blended (default): users + hashtags
const { json } = await igFetch(accountName,
  `/api/v1/web/search/topsearch/?context=blended&query=${encodeURIComponent(query)}&rank_token=0.1`);
if (raw) { console.log(JSON.stringify(json, null, 2)); process.exit(0); }
console.log(`=== "${query}" blended search ===`);
console.log(`\n👤 users (${json?.users?.length || 0}):`);
for (const { user: u } of (json?.users || []).slice(0, 10)) {
  const fans = u.follower_count ? `  fans=${fmt(u.follower_count)}` : "";
  console.log(`  @${u.username}${u.is_verified ? " ✔" : ""}${fans}  ${u.full_name || ""}`);
}
console.log(`\n#️⃣ hashtags (${json?.hashtags?.length || 0}):`);
for (const { hashtag: h } of (json?.hashtags || []).slice(0, 10)) {
  console.log(`  #${h.name}  (${fmt(h.media_count)} posts)`);
}
