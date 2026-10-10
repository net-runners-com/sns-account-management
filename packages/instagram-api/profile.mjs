// Instagram プロフィール取得 CLI
//
//   node profile.mjs --account <name> <username>          # 整形 summary
//   node profile.mjs --account <name> <username> --raw    # 生 JSON (user オブジェクト全体)
//   node profile.mjs --account <name> <username> --posts  # 直近投稿も一覧
//
// web_profile_info エンドポイント (RE 実証済み, 200)。
import { igFetch } from "./lib/http.mjs";

const args = process.argv.slice(2);
let accountName = process.env.INSTAGRAM_ACCOUNT || null, raw = false, showPosts = false;
const positional = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--account") accountName = args[++i];
  else if (a === "--raw") raw = true;
  else if (a === "--posts") showPosts = true;
  else positional.push(a);
}
const username = positional[0];
if (!accountName || !username) {
  console.error("usage: node profile.mjs --account NAME [--raw] [--posts] <username>");
  process.exit(1);
}

const { status, json } = await igFetch(accountName,
  `/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`);
const user = json?.data?.user;
if (!user) { console.error(`[!] user not found (status ${status}): @${username}`); process.exit(2); }

if (raw) { console.log(JSON.stringify(user, null, 2)); process.exit(0); }

const fmt = (n) => (n ?? 0).toLocaleString("en-US");
console.log(`@${user.username}${user.is_verified ? " ✔" : ""}  (${user.full_name || ""})`);
console.log(`  id:        ${user.id}`);
console.log(`  followers: ${fmt(user.edge_followed_by?.count)}   following: ${fmt(user.edge_follow?.count)}`);
console.log(`  posts:     ${fmt(user.edge_owner_to_timeline_media?.count)}`);
console.log(`  private:   ${user.is_private}   business: ${user.is_business_account}   category: ${user.category_name || "-"}`);
if (user.biography) console.log(`  bio:       ${user.biography.replace(/\n/g, " / ").slice(0, 120)}`);
if (user.external_url) console.log(`  link:      ${user.external_url}`);

if (showPosts) {
  const edges = user.edge_owner_to_timeline_media?.edges || [];
  console.log(`\n  === 直近 ${edges.length} 投稿 ===`);
  for (const { node } of edges) {
    const cap = (node.edge_media_to_caption?.edges?.[0]?.node?.text || "").replace(/\n/g, " ").slice(0, 50);
    const d = node.taken_at_timestamp ? new Date(node.taken_at_timestamp * 1000).toISOString().slice(0, 10) : "?";
    const type = node.is_video ? "🎬" : (node.__typename === "GraphSidecar" ? "🖼x" : "📷");
    console.log(`  [${d}] ${type} ❤${fmt(node.edge_liked_by?.count)} 💬${fmt(node.edge_media_to_comment?.count)} ${cap}`);
    console.log(`        https://www.instagram.com/p/${node.shortcode}/`);
  }
}
