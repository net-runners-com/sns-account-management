// Instagram ユーザー投稿一覧 CLI (pagination 対応)
//
//   node posts.mjs --account <name> <username>            # 全件 (pagination)
//   node posts.mjs --account <name> <username> --max 30   # 最大件数
//   node posts.mjs --account <name> <username> --raw      # 生 items JSON
//
// 流れ: web_profile_info で user_id 解決 → feed/user/{id}/ を next_max_id で辿る
import { igFetch } from "./lib/http.mjs";

const args = process.argv.slice(2);
let accountName = process.env.INSTAGRAM_ACCOUNT || null, raw = false, max = 0;
const positional = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--account") accountName = args[++i];
  else if (a === "--raw") raw = true;
  else if (a === "--max") max = Number(args[++i]);
  else positional.push(a);
}
const username = positional[0];
if (!accountName || !username) {
  console.error("usage: node posts.mjs --account NAME [--max N] [--raw] <username>");
  process.exit(1);
}

// 1. user_id 解決
const prof = await igFetch(accountName, `/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`);
const user = prof.json?.data?.user;
if (!user) { console.error(`[!] user not found: @${username}`); process.exit(2); }
const userId = user.id;

// 2. feed/user pagination
const all = [];
let cursor = null, page = 0;
do {
  const qs = `?count=33${cursor ? `&max_id=${encodeURIComponent(cursor)}` : ""}`;
  const { json } = await igFetch(accountName, `/api/v1/feed/user/${userId}/${qs}`);
  const items = json?.items || [];
  all.push(...items);
  cursor = json?.more_available ? json?.next_max_id : null;
  page++;
  process.stderr.write(`\r[posts] page ${page}: +${items.length} (total ${all.length})   `);
  if (max && all.length >= max) break;
  await new Promise(r => setTimeout(r, 600 + Math.random() * 500)); // jitter
} while (cursor);
process.stderr.write("\n");

const sliced = max ? all.slice(0, max) : all;
if (raw) { console.log(JSON.stringify(sliced, null, 2)); process.exit(0); }

const fmt = (n) => (n ?? 0).toLocaleString("en-US");
console.log(`@${user.username} — ${sliced.length} posts`);
console.log("─".repeat(70));
for (const it of sliced) {
  const d = it.taken_at ? new Date(it.taken_at * 1000).toISOString().slice(0, 16).replace("T", " ") : "?";
  const type = it.media_type === 2 ? "🎬" : (it.carousel_media_count ? `🖼x${it.carousel_media_count}` : "📷");
  const views = it.play_count || it.ig_play_count;
  const cap = (it.caption?.text || "").replace(/\n/g, " ").slice(0, 46);
  console.log(`[${d}] ${type} ❤${fmt(it.like_count)} 💬${fmt(it.comment_count)}${views ? ` ▶${fmt(views)}` : ""} ${cap}`);
  console.log(`   https://www.instagram.com/p/${it.code}/`);
}
