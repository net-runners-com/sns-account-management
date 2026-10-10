// Threads キーワード検索 CLI
//
//   node search.mjs --account <name> --q <keyword>
//   node search.mjs --account <name> --q <keyword> --max 50
//   node search.mjs --account <name> --q <keyword> --serp-type trends --trend-fbid <ID>
//   node search.mjs --account <name> --q <keyword> --raw            # 1ページ目の生 JSON
import { searchThreads, searchPage } from "./lib/search.mjs";

const args = process.argv.slice(2);
let accountName = process.env.THREADS_ACCOUNT || null;
let query = null;
let max = 50, perPage = 10;
let raw = false;
let serpType = "default";
let trendFbid = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--account") accountName = args[++i];
  else if (args[i] === "--q") query = args[++i];
  else if (args[i] === "--max") max = Number(args[++i]);
  else if (args[i] === "--per-page") perPage = Number(args[++i]);
  else if (args[i] === "--serp-type") serpType = args[++i];
  else if (args[i] === "--trend-fbid") { trendFbid = args[++i]; serpType = "trends"; }
  else if (args[i] === "--raw") raw = true;
  // 旧 --scrolls オプション (互換)
  else if (args[i] === "--scrolls") max = perPage * Number(args[++i]);
}
if (!accountName || !query) {
  console.error("usage: node search.mjs --account NAME --q '<keyword>' [--max N] [--per-page N] [--serp-type default|trends] [--trend-fbid ID] [--raw]");
  process.exit(1);
}

console.error(`[search] account=${accountName} q="${query}" serp=${serpType}${trendFbid ? ` trend_fbid=${trendFbid}` : ""}`);

if (raw) {
  const r = await searchPage({ accountName, query, first: perPage, serpType, trendFbid });
  console.log(JSON.stringify(r.raw, null, 2));
  process.exit(0);
}

const result = await searchThreads({
  accountName, query, max, perPage, serpType, trendFbid,
  onPage: ({ pageNo, count, total }) =>
    console.error(`[search] page=${pageNo} got=${count} total=${total}`),
});
console.error(`[search] done. total=${result.posts.length}`);
console.log(JSON.stringify(result, null, 2));
