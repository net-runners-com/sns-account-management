// Threads トレンド一覧 CLI
//
//   node trends.mjs --account <name>
//   node trends.mjs --account <name> --raw
//   node trends.mjs --account <name> --scrolls 10  # 全件出すなら多めに
//
// account は --account or env THREADS_ACCOUNT 必須.
import { getTrends, summarizeTrends } from "./lib/trends.mjs";

const args = process.argv.slice(2);
let accountName = process.env.THREADS_ACCOUNT || null, raw = false, scrolls = 8;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--account") accountName = args[++i];
  else if (args[i] === "--raw") raw = true;
  else if (args[i] === "--scrolls") scrolls = Number(args[++i]);
}
if (!accountName) {
  console.error("usage: node trends.mjs --account NAME [--raw] [--scrolls 8]");
  process.exit(1);
}

console.log(`[trends] account=${accountName}`);
const trends = await getTrends({ accountName, scrolls });
console.log(`got ${trends.length} trends`);

if (raw) {
  console.log(JSON.stringify(trends, null, 2));
} else {
  for (const t of summarizeTrends(trends)) {
    console.log(`#${t.rank}  ${t.headline}  (投稿${t.posts || "?"}件)`);
    console.log(`     keyword: ${t.keyword}  trend_fbid: ${t.trend_fbid}`);
    if (t.summary) console.log(`     ${t.summary}`);
    console.log();
  }
}
