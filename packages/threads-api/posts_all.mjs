// 全投稿スクレイプ CLI (Playwright)
//
//   node posts_all.mjs --account <name> <username>
//   node posts_all.mjs --account <name> <username> --headed     # 確認用 (画面見せる)
//   node posts_all.mjs --account <name> <username> --raw        # 全 field
//   node posts_all.mjs --account <name> <username> --max-scrolls 100
//   node posts_all.mjs --account <name> <username> --debug      # 捕獲した friendly_name + doc_id 表示
//
// account は --account or env THREADS_ACCOUNT 必須.
import { scrapeUserPosts } from "./lib/playwright_posts.mjs";

const args = process.argv.slice(2);
let accountName = process.env.THREADS_ACCOUNT || null, raw = false, headed = false, debug = false, maxScrolls = 50;
const positional = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--account") { accountName = args[++i]; continue; }
  if (a === "--raw") { raw = true; continue; }
  if (a === "--headed") { headed = true; continue; }
  if (a === "--debug") { debug = true; continue; }
  if (a === "--max-scrolls") { maxScrolls = Number(args[++i]); continue; }
  positional.push(a);
}

const username = positional[0];
if (!username || !accountName) {
  console.error("usage: node posts_all.mjs --account NAME [--headed] [--raw] [--debug] [--max-scrolls 50] <username>");
  process.exit(1);
}

console.log(`[scrape] account=${accountName} target=@${username.replace(/^@/, "")} headless=${!headed}`);
const t0 = Date.now();
const result = await scrapeUserPosts({
  username, accountName, maxScrolls,
  headless: !headed,
  onProgress: ({ phase, scrolls, posts }) => {
    if (phase === "scroll") process.stderr.write(`\r  scroll ${scrolls}/${maxScrolls}  posts=${posts}  `);
  },
});
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
console.error("");
console.log(`done in ${elapsed}s — ${result.posts.length} posts, ${result.graphqlResponseCount} graphql responses`);

if (debug) {
  console.log("\n--- captured friendly_names + doc_ids ---");
  for (const fn of result.friendlyNames.sort()) {
    console.log(`  ${fn}${result.docIds[fn] ? " → " + result.docIds[fn] : ""}`);
  }
  console.log("");
}

if (raw) {
  console.log(JSON.stringify(result.posts, null, 2));
} else {
  const sumLikes = result.posts.reduce((a, p) => a + (p.counts.likes || 0), 0);
  const sumReplies = result.posts.reduce((a, p) => a + (p.counts.replies || 0), 0);
  const sumReposts = result.posts.reduce((a, p) => a + (p.counts.reposts || 0), 0);
  console.log(`合計 ❤${sumLikes}  💬${sumReplies}  🔁${sumReposts}\n`);
  for (const p of result.posts) {
    const t = p.taken_at ? new Date(p.taken_at * 1000).toISOString().slice(0, 16).replace("T", " ") : "?";
    const c = p.counts;
    const text = (p.text || "").replace(/\n/g, " ").slice(0, 60);
    console.log(`[${t}] ❤${c.likes ?? "-"} 💬${c.replies ?? "-"} 🔁${c.reposts ?? "-"} 💭${c.quotes ?? "-"} ${p.is_pinned ? "📌 " : ""}${text}${p.text && p.text.length > 60 ? "…" : ""}`);
    console.log(`   pk=${p.pk}  ${p.url || ""}`);
  }
}
