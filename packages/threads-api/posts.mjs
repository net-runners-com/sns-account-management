// プロフィール投稿一覧 CLI
//
//   node posts.mjs --account <name> <username>            # 全件 (pagination, デフォルト)
//   node posts.mjs --account <name> <username> --first 12 # 1ページ件数
//   node posts.mjs --account <name> <username> --max 5    # 最大ページ数 (early stop)
//   node posts.mjs --account <name> <username> --raw      # 全 field
//   node posts.mjs <username> --quick                     # HTML SSR のみ (~5件, 認証なし可)
//
// account は --account or env THREADS_ACCOUNT (--quick 時のみ任意).
import { getUserPosts, getAllUserPosts } from "./lib/user_posts.mjs";

const args = process.argv.slice(2);
let accountName = process.env.THREADS_ACCOUNT || null;
let raw = false, quick = false, ownOnly = false;
let first = 25, maxPages = 50;
const positional = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--account") { accountName = args[++i]; continue; }
  if (a === "--raw") { raw = true; continue; }
  if (a === "--quick") { quick = true; continue; }
  if (a === "--own") { ownOnly = true; continue; }
  if (a === "--first") { first = Number(args[++i]); continue; }
  if (a === "--max") { maxPages = Number(args[++i]); continue; }
  positional.push(a);
}

const username = positional[0];
if (!username) {
  console.error("usage: node posts.mjs --account NAME [--quick|--first N|--max N|--raw] <username>");
  process.exit(1);
}

let posts;
if (quick) {
  posts = await getUserPosts({ username, accountName });
} else {
  if (!accountName) { console.error("--account required for full pagination (use --quick for ~5件公開だけ)"); process.exit(1); }
  posts = await getAllUserPosts({
    username, accountName, first, maxPages,
    onPage: ({ page, posts, totalPosts, hasNext }) => {
      process.stderr.write(`\rpage ${page}: +${posts} (total ${totalPosts}) hasNext=${hasNext}  `);
    },
  });
  process.stderr.write("\n");
}
if (ownOnly) {
  const u = String(username).replace(/^@/, "").toLowerCase();
  posts = posts.filter((p) => (p.user?.username || "").toLowerCase() === u);
}
posts.sort((a, b) => Number(b.pk) - Number(a.pk));

if (raw) {
  console.log(JSON.stringify(posts, null, 2));
} else {
  console.log(`${posts.length} posts found for @${username.replace(/^@/, "")}`);
  console.log("─".repeat(70));
  for (const p of posts) {
    const t = p.taken_at ? new Date(p.taken_at * 1000).toISOString().slice(0, 16).replace("T", " ") : "?";
    const c = p.counts;
    const text = (p.text || "").replace(/\n/g, " ").slice(0, 60);
    console.log(`[${t}] ❤${c.likes ?? "-"} 💬${c.replies ?? "-"} 🔁${c.reposts ?? "-"} 💭${c.quotes ?? "-"} ${p.is_pinned ? "📌 " : ""}${text}${p.text && p.text.length > 60 ? "…" : ""}`);
    console.log(`   pk=${p.pk} ${p.url || ""}`);
  }
}
