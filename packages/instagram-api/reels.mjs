// Instagram リール取得 CLI
//
//   node reels.mjs --account NAME <username>            # ユーザーのリール (pagination 全件)
//   node reels.mjs --account NAME <username> --max 30   # 最大件数
//   node reels.mjs --account NAME <username> --sort likes|views|recent
//   node reels.mjs --account NAME <username> --min-likes 10000 --min-views 1000000
//   node reels.mjs --account NAME --discover            # discover / トレンドのリール
//   node reels.mjs --account NAME <username> --raw      # 生 media items JSON
//
// clips/user (target_user_id) / clips/discover — RE 実証済 200。clips/home は 404。
//
// accounts: INSTAGRAM_ACCOUNTS_PATH 未設定なら repo-root の accounts/ に自動フォールバック。
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
if (!process.env.INSTAGRAM_ACCOUNTS_PATH) {
  const rootAcc = resolve(__dirname, "../../accounts/instagram_accounts.json");
  if (existsSync(rootAcc)) process.env.INSTAGRAM_ACCOUNTS_PATH = rootAcc;
}
// env 設定後に import (session.mjs は import 時に ACCOUNTS_FILE を確定するため動的 import)
const { igFetch } = await import("./lib/http.mjs");

const args = process.argv.slice(2);
let accountName = process.env.INSTAGRAM_ACCOUNT || null;
let raw = false, discover = false, max = 0, sort = "recent", minLikes = 0, minViews = 0;
const positional = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--account") accountName = args[++i];
  else if (a === "--discover") discover = true;
  else if (a === "--raw") raw = true;
  else if (a === "--max") max = Number(args[++i]);
  else if (a === "--sort") sort = args[++i];
  else if (a === "--min-likes") minLikes = Number(args[++i]);
  else if (a === "--min-views") minViews = Number(args[++i]);
  else positional.push(a);
}
const username = positional[0];
if (!accountName || (!username && !discover)) {
  console.error("usage: node reels.mjs --account NAME (<username> | --discover) [--max N] [--sort likes|views|recent] [--min-likes N] [--min-views N] [--raw]");
  process.exit(1);
}

const PAGE = 12;
const views = (m) => m.play_count || m.ig_play_count || 0;
const jitter = () => new Promise((r) => setTimeout(r, 600 + Math.random() * 500));

let items = [], user = null;

if (discover) {
  let cursor = null, page = 0;
  do {
    const body = `container_module=clips_viewer&page_size=${PAGE}` + (cursor ? `&max_id=${encodeURIComponent(cursor)}` : "");
    const { json } = await igFetch(accountName, "/api/v1/clips/discover/", { method: "POST", body });
    const batch = (json?.items || []).map((x) => x.media || x);
    items.push(...batch);
    cursor = json?.paging_info?.more_available ? json?.paging_info?.max_id : null;
    process.stderr.write(`\r[reels] discover page ${++page}: +${batch.length} (total ${items.length})   `);
    if (!batch.length) break;
    if (max && items.length >= max) break;
    await jitter();
  } while (cursor && page < 30);
  process.stderr.write("\n");
} else {
  const prof = await igFetch(accountName, `/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`);
  user = prof.json?.data?.user;
  if (!user) { console.error(`[!] user not found: @${username}`); process.exit(2); }
  let cursor = null, page = 0;
  do {
    const body = `target_user_id=${user.id}&page_size=${PAGE}&include_feed_video=true` + (cursor ? `&max_id=${encodeURIComponent(cursor)}` : "");
    const { json } = await igFetch(accountName, "/api/v1/clips/user/", { method: "POST", body });
    const batch = (json?.items || []).map((x) => x.media || x);
    items.push(...batch);
    cursor = json?.paging_info?.more_available ? json?.paging_info?.max_id : null;
    process.stderr.write(`\r[reels] @${username} page ${++page}: +${batch.length} (total ${items.length})   `);
    if (!batch.length) break;
    if (max && items.length >= max) break;
    await jitter();
  } while (cursor && page < 50);
  process.stderr.write("\n");
}

// 重複排除 (code / pk)
const seen = new Set();
items = items.filter((m) => { const k = m.code || m.pk; if (!k || seen.has(k)) return false; seen.add(k); return true; });

// フィルタ
const before = items.length;
if (minLikes || minViews) items = items.filter((m) => (m.like_count || 0) >= minLikes && views(m) >= minViews);

// ソート
if (sort === "likes") items.sort((a, b) => (b.like_count || 0) - (a.like_count || 0));
else if (sort === "views") items.sort((a, b) => views(b) - views(a));
else items.sort((a, b) => (b.taken_at || 0) - (a.taken_at || 0)); // recent

const sliced = max ? items.slice(0, max) : items;

if (raw) { console.log(JSON.stringify(sliced, null, 2)); process.exit(0); }

const fmt = (n) => (n ?? 0).toLocaleString("en-US");
console.log(discover ? `discover reels — ${sliced.length}` : `@${user.username} — ${sliced.length} reels${before !== items.length ? ` (filtered from ${before})` : ""}`);
console.log("─".repeat(70));
for (const m of sliced) {
  const d = m.taken_at ? new Date(m.taken_at * 1000).toISOString().slice(0, 16).replace("T", " ") : "?";
  const who = discover ? `@${m.user?.username} ` : "";
  const dur = m.video_duration ? ` ⏱${Math.round(m.video_duration)}s` : "";
  const cap = (m.caption?.text || "").replace(/\n/g, " ").slice(0, 46);
  console.log(`[${d}] ${who}▶${fmt(views(m))} ❤${fmt(m.like_count)} 💬${fmt(m.comment_count)}${dur}  ${cap}`);
  console.log(`   https://www.instagram.com/reel/${m.code}/`);
}
