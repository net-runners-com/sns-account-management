// X 検索 CLI (pure HTTP — x-client-transaction-id npm package で署名)
//
//   node search.mjs --account hirotohiroto_x "AI 活用"
//   node search.mjs --account hirotohiroto_x --product Latest "AI 活用"
//   node search.mjs --account hirotohiroto_x --count 100 "AI 活用"
//   node search.mjs --account hirotohiroto_x --min-followers 10000 "AI 活用"
//   node search.mjs --account hirotohiroto_x --min-likes 100 "AI 活用"
//   node search.mjs --account hirotohiroto_x --sort followers "AI 活用"
//   node search.mjs --account hirotohiroto_x --sort likes "AI 活用"
//   node search.mjs --account hirotohiroto_x --raw "AI 活用"           # 1ページ目の生 JSON
import { getAccount } from "./session.mjs";
import { searchAll, fetchSearchPage } from "./lib/search.mjs";
import { XSessionError, formatSessionErrorForCLI } from "./lib/errors.mjs";
import { saveData, parseSaveFlags } from "./lib/save.mjs";

const { noSave, saveDir, remaining: args } = parseSaveFlags(process.argv.slice(2));
let accountName = process.env.X_ACCOUNT || null;
let product = "Top";
let count = 50;
let raw = false;
let minFollowers = 0, minLikes = 0, minViews = 0;
let sort = null;
const positional = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--account") { accountName = args[++i]; continue; }
  if (a === "--product") { product = args[++i]; continue; }
  if (a === "--count") { count = Number(args[++i]); continue; }
  if (a === "--min-followers") { minFollowers = Number(args[++i]); continue; }
  if (a === "--min-likes") { minLikes = Number(args[++i]); continue; }
  if (a === "--min-views") { minViews = Number(args[++i]); continue; }
  if (a === "--sort") { sort = args[++i]; continue; }
  if (a === "--raw") { raw = true; continue; }
  positional.push(a);
}
const rawQuery = positional.join(" ").trim();
if (!accountName || !rawQuery) {
  console.error('usage: node search.mjs --account <name> [--product Top|Latest|People|Photos|Videos] [--count N] [--min-followers N|--min-likes N|--min-views N] [--sort followers|likes|views|recent] [--raw] [--no-save] [--save-dir <path>] "<keyword>"');
  process.exit(1);
}

if (!["Top", "Latest", "People", "Photos", "Videos"].includes(product)) {
  console.error(`unknown --product: ${product}`);
  process.exit(1);
}

try {
  const acc = getAccount(accountName);

  if (raw) {
    const json = await fetchSearchPage(acc, { rawQuery, product, count: 20, accountName });
    console.log(JSON.stringify(json, null, 2));
    if (!noSave) {
      const p = saveData({ account: accountName, task: "search", suffix: `raw-${product}`, context: rawQuery, data: json, dir: saveDir });
      console.error(`[search] saved: ${p}`);
    }
    process.exit(0);
  }

  const { tweets, users } = await searchAll(acc, {
    rawQuery, max: count, product, accountName,
    onPage: ({ pageNo, tweets, users, total }) =>
      console.error(`[search] page=${pageNo} tweets=${tweets} users=${users} total=${total}`),
  });

  let filtered = tweets;
  const before = filtered.length;
  if (minFollowers || minLikes || minViews) {
    filtered = filtered.filter((t) =>
      (t.user.followers_count ?? 0) >= minFollowers &&
      t.favorite_count >= minLikes &&
      t.view_count >= minViews
    );
  }
  if (sort === "followers") filtered.sort((a, b) => (b.user.followers_count ?? 0) - (a.user.followers_count ?? 0));
  else if (sort === "likes") filtered.sort((a, b) => b.favorite_count - a.favorite_count);
  else if (sort === "views") filtered.sort((a, b) => b.view_count - a.view_count);
  else if (sort === "recent") filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  console.error(`[search] result tweets=${filtered.length}${before !== filtered.length ? ` (filtered from ${before})` : ""} users=${users.length}`);
  const result = { rawQuery, product, sort, filters: { minFollowers, minLikes, minViews }, tweets: filtered, users };
  console.log(JSON.stringify(result, null, 2));
  if (!noSave) {
    const p = saveData({ account: accountName, task: "search", suffix: product, context: rawQuery, data: result, dir: saveDir });
    console.error(`[search] saved: ${p}`);
  }
} catch (e) {
  if (e instanceof XSessionError) {
    console.error(formatSessionErrorForCLI(e));
    process.exit(2);
  }
  console.error(`ERROR: ${e.message}`);
  process.exit(1);
}
