// Instagram 自分のフィード / ストーリーズトレイ CLI
//
//   node feed.mjs --account <name>              # ホームタイムライン
//   node feed.mjs --account <name> --stories    # ストーリーズトレイ
//   node feed.mjs --account <name> --raw
//
// feed/timeline (POST) / feed/reels_tray (GET) — RE 実証済み, 200。
import { igFetch } from "./lib/http.mjs";

const args = process.argv.slice(2);
let accountName = process.env.INSTAGRAM_ACCOUNT || null, raw = false, stories = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--account") accountName = args[++i];
  else if (args[i] === "--raw") raw = true;
  else if (args[i] === "--stories") stories = true;
}
if (!accountName) { console.error("usage: node feed.mjs --account NAME [--stories] [--raw]"); process.exit(1); }
const fmt = (n) => (n ?? 0).toLocaleString("en-US");

if (stories) {
  const { json } = await igFetch(accountName, "/api/v1/feed/reels_tray/");
  if (raw) { console.log(JSON.stringify(json, null, 2)); process.exit(0); }
  const tray = json?.tray || [];
  console.log(`stories tray: ${tray.length} 人`);
  console.log("─".repeat(60));
  for (const r of tray) {
    const u = r.user || {};
    console.log(`@${u.username}${u.is_verified ? " ✔" : ""}  items=${r.media_count ?? "?"}  ${r.seen ? "(既読)" : "🔴未読"}`);
  }
  process.exit(0);
}

const { json } = await igFetch(accountName, "/api/v1/feed/timeline/",
  { method: "POST", body: "reason=cold_start_fetch&is_pull_to_refresh=0" });
if (raw) { console.log(JSON.stringify(json, null, 2)); process.exit(0); }
const items = json?.feed_items || [];
console.log(`timeline: ${items.length} items  (more=${json?.more_available})`);
console.log("─".repeat(70));
for (const fi of items) {
  const m = fi.media_or_ad;
  if (!m) continue;
  const u = m.user || {};
  const d = m.taken_at ? new Date(m.taken_at * 1000).toISOString().slice(5, 16).replace("T", " ") : "?";
  const type = m.media_type === 2 ? "🎬" : (m.carousel_media_count ? `🖼x${m.carousel_media_count}` : "📷");
  const cap = (m.caption?.text || "").replace(/\n/g, " ").slice(0, 44);
  console.log(`[${d}] ${type} @${u.username} ❤${fmt(m.like_count)} 💬${fmt(m.comment_count)} ${cap}`);
  console.log(`   https://www.instagram.com/p/${m.code}/`);
}
