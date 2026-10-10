// 投稿の返信 (コメント) を取得する CLI
//
// 使い方:
//   node --env-file=.env replies.mjs <post_url> [--account NAME]
//   node --env-file=.env replies.mjs https://www.threads.com/@your_username/post/DXoQw9fCc9T
//   node --env-file=.env replies.mjs --account myaccount --user your_username --code DXoQw9fCc9T
//   node --env-file=.env replies.mjs --json   # raw JSON 出力
import { getPostWithReplies } from "./lib/replies.mjs";

const args = process.argv.slice(2);
let accountName = process.env.THREADS_ACCOUNT || null;
let postUrl = null;
let username = null;
let code = null;
let asJson = false;

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--account") accountName = args[++i];
  else if (a === "--user") username = args[++i];
  else if (a === "--code") code = args[++i];
  else if (a === "--json") asJson = true;
  else if (!a.startsWith("--")) postUrl = a;
}

if (!accountName) {
  console.error("--account NAME (or env THREADS_ACCOUNT) required");
  process.exit(1);
}
if (!postUrl && !(username && code)) {
  console.error("post_url or --user X --code Y required");
  console.error("ex: replies.mjs https://www.threads.com/@your_username/post/DXoQw9fCc9T --account myaccount");
  process.exit(1);
}

const { post, replies } = await getPostWithReplies({ accountName, username, code, postUrl });

if (asJson) {
  console.log(JSON.stringify({ post, replies }, null, 2));
  process.exit(0);
}

if (!post) {
  console.log("(post not found in HTML)");
  process.exit(1);
}

const fmtTime = (t) => (t ? new Date(t * 1000).toISOString().slice(0, 19).replace("T", " ") : "?");

console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`📝 @${post.user?.username || "?"}  ${fmtTime(post.taken_at)}`);
console.log(`   ❤${post.counts.likes ?? "-"} 💬${post.counts.replies ?? "-"} 🔁${post.counts.reposts ?? "-"} 📝${post.counts.quotes ?? "-"}`);
console.log(`   ${post.text || "(no text)"}`);
if (post.url) console.log(`   ${post.url}`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`💬 返信 ${replies.length} 件:`);
console.log();

if (replies.length === 0) {
  console.log("  (返信なし)");
} else {
  for (const r of replies) {
    console.log(`  └ @${r.user?.username || "?"}  ${fmtTime(r.taken_at)}`);
    console.log(`    ❤${r.counts.likes ?? "-"} 💬${r.counts.replies ?? "-"}`);
    if (r.text) {
      for (const line of r.text.split("\n")) console.log(`    ${line}`);
    }
    if (r.url) console.log(`    ${r.url}`);
    console.log();
  }
}
