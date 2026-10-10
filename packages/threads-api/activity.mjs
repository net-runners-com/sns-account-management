// Threads アクティビティフィード CLI
//
//   node activity.mjs --account <name>
//   node activity.mjs --account <name> --first 50
//   node activity.mjs --account <name> --raw
//   node activity.mjs --account <name> --mark-seen
//
// account は --account or env THREADS_ACCOUNT 必須.
import { getActivityFeed, summarizeActivity, markActivityAsSeen } from "./lib/activity.mjs";

const args = process.argv.slice(2);
let accountName = process.env.THREADS_ACCOUNT || null, raw = false, first = 30, markSeen = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--account") accountName = args[++i];
  else if (args[i] === "--raw") raw = true;
  else if (args[i] === "--first") first = Number(args[++i]);
  else if (args[i] === "--mark-seen") markSeen = true;
}
if (!accountName) {
  console.error("usage: node activity.mjs --account NAME [--first 30] [--raw] [--mark-seen]");
  process.exit(1);
}

if (markSeen) {
  console.log("[mark-seen]");
  const r = await markActivityAsSeen({ accountName });
  console.log(`HTTP ${r.http}`, JSON.stringify(r.json).slice(0, 200));
  process.exit(r.json?.errors ? 1 : 0);
}

console.log(`[activity] account=${accountName} first=${first}`);
const r = await getActivityFeed({ accountName, first });
console.log(`HTTP ${r.http}`);
if (r.json?.errors) {
  console.log("errors:", JSON.stringify(r.json.errors[0]).slice(0, 300));
  process.exit(1);
}
const edges = r.json?.data?.notifications?.edges || [];
console.log(`${edges.length} activity items\n`);

if (raw) {
  console.log(JSON.stringify(r.json, null, 2));
} else {
  const items = summarizeActivity(r.json);
  for (const it of items) {
    const icon = { like: "❤", reply: "💬", repost: "🔁", quote: "💭", follow: "➕", mention: "@", recommend: "🌟", following_post: "👥", follow_or_recommend: "👤" }[it.type] || "•";
    console.log(`${icon}  @${it.from_username}  (${it.timestamp})`);
    if (it.content_preview) console.log(`     "${it.content_preview}"`);
    if (it.target_post_code) console.log(`     → /post/${it.target_post_code}`);
    console.log();
  }
}
