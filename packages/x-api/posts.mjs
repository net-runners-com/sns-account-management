// X 自分(or 指定ユーザー)の全投稿取得 CLI
//
//   node posts.mjs --account hirotohiroto_x                        # 自分の全投稿
//   node posts.mjs --account hirotohiroto_x --user-id 123456
//   node posts.mjs --account hirotohiroto_x --screen-name amane_sns
//   node posts.mjs --account hirotohiroto_x --max 50
//   node posts.mjs --account hirotohiroto_x --raw                  # 1ページ目の生 JSON
import { getAccount } from "./session.mjs";
import { getProfileByScreenName } from "./lib/profile.mjs";
import { fetchUserTweetsPage, getAllUserTweets } from "./lib/user_tweets.mjs";
import { XSessionError, formatSessionErrorForCLI } from "./lib/errors.mjs";
import { saveData, parseSaveFlags } from "./lib/save.mjs";

const { noSave, saveDir, remaining: args } = parseSaveFlags(process.argv.slice(2));
let accountName = process.env.X_ACCOUNT || null;
let userId = null;
let screenName = null;
let max = Infinity;
let perPage = 40;
let raw = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--account") { accountName = args[++i]; continue; }
  if (a === "--user-id") { userId = args[++i]; continue; }
  if (a === "--screen-name") { screenName = args[++i].replace(/^@/, ""); continue; }
  if (a === "--max") { max = Number(args[++i]); continue; }
  if (a === "--per-page") { perPage = Number(args[++i]); continue; }
  if (a === "--raw") { raw = true; continue; }
}
if (!accountName) {
  console.error("usage: node posts.mjs --account <name> [--user-id <id>|--screen-name <h>] [--max N] [--raw] [--no-save] [--save-dir <path>]");
  process.exit(1);
}

try {
  const acc = getAccount(accountName);

  if (screenName && !userId) {
    const p = await getProfileByScreenName(acc, { screenName, accountName });
    if (!p?.user_id) {
      console.error(`screen_name 解決失敗: @${screenName}`);
      process.exit(1);
    }
    userId = p.user_id;
    console.error(`[posts] @${screenName} → user_id=${userId}`);
  }
  if (!userId) userId = acc.user_id;

  const ctx = screenName || userId;

  if (raw) {
    const json = await fetchUserTweetsPage(acc, { userId, count: perPage, accountName });
    console.log(JSON.stringify(json, null, 2));
    if (!noSave) {
      const p = saveData({ account: accountName, task: "posts", suffix: "raw", context: ctx, data: json, dir: saveDir });
      console.error(`[posts] saved: ${p}`);
    }
    process.exit(0);
  }

  const tweets = await getAllUserTweets(acc, {
    userId,
    accountName,
    max,
    perPage,
    onPage: ({ pageNo, count, total }) =>
      console.error(`[posts] page=${pageNo} got=${count} total=${total}`),
  });
  console.error(`[posts] done. total=${tweets.length}`);
  console.log(JSON.stringify(tweets, null, 2));
  if (!noSave) {
    const p = saveData({ account: accountName, task: "posts", context: ctx, data: tweets, dir: saveDir });
    console.error(`[posts] saved: ${p}`);
  }
} catch (e) {
  if (e instanceof XSessionError) {
    console.error(formatSessionErrorForCLI(e));
    process.exit(2);
  }
  console.error(`ERROR: ${e.message}`);
  process.exit(1);
}
