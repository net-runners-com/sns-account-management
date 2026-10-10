// X フォロワー / フォロー中 一覧 CLI
//
//   node follows.mjs --account hirotohiroto_x --screen-name amane_sns               # フォロワー (default)
//   node follows.mjs --account hirotohiroto_x --screen-name amane_sns --following   # フォロー中
//   node follows.mjs --account hirotohiroto_x --screen-name amane_sns --verified    # Blue Verified followers
//   node follows.mjs --account hirotohiroto_x --user-id 1234 --max 200
//   node follows.mjs --account hirotohiroto_x --screen-name amane_sns --raw         # 1ページ目の生 JSON
import { getAccount } from "./session.mjs";
import { getProfileByScreenName } from "./lib/profile.mjs";
import { fetchFollowsPage, getAllFollows } from "./lib/follows.mjs";
import { XSessionError, formatSessionErrorForCLI } from "./lib/errors.mjs";
import { saveData, parseSaveFlags } from "./lib/save.mjs";

const { noSave, saveDir, remaining: args } = parseSaveFlags(process.argv.slice(2));
let accountName = process.env.X_ACCOUNT || null;
let userId = null, screenName = null;
let kind = "Followers";
let max = 100;
let raw = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--account") { accountName = args[++i]; continue; }
  if (a === "--user-id") { userId = args[++i]; continue; }
  if (a === "--screen-name") { screenName = args[++i].replace(/^@/, ""); continue; }
  if (a === "--following") { kind = "Following"; continue; }
  if (a === "--verified") { kind = "BlueVerifiedFollowers"; continue; }
  if (a === "--max") { max = Number(args[++i]); continue; }
  if (a === "--raw") { raw = true; continue; }
}
if (!accountName || (!userId && !screenName)) {
  console.error('usage: node follows.mjs --account <name> [--user-id <id>|--screen-name <h>] [--following|--verified] [--max N] [--raw] [--no-save] [--save-dir <path>]');
  process.exit(1);
}

try {
  const acc = getAccount(accountName);
  if (!userId && screenName) {
    const p = await getProfileByScreenName(acc, { screenName, accountName });
    if (!p?.user_id) { console.error(`screen_name 解決失敗: @${screenName}`); process.exit(1); }
    userId = p.user_id;
    console.error(`[follows] @${screenName} → user_id=${userId} (${kind === "Followers" ? "followers" : kind === "Following" ? "following" : "blue verified followers"} of ${p.followers_count})`);
  }

  const ctx = screenName || userId;

  if (raw) {
    const json = await fetchFollowsPage(acc, { userId, kind, count: 20, accountName });
    console.log(JSON.stringify(json, null, 2));
    if (!noSave) {
      const p = saveData({ account: accountName, task: "follows", suffix: `raw-${kind}`, context: ctx, data: json, dir: saveDir });
      console.error(`[follows] saved: ${p}`);
    }
    process.exit(0);
  }

  const users = await getAllFollows(acc, {
    userId, kind, max, accountName,
    onPage: ({ pageNo, gotThisPage, newThisPage, total }) =>
      console.error(`[follows] page=${pageNo} got=${gotThisPage} new=${newThisPage} total=${total}`),
  });
  console.error(`[follows] result count=${users.length}`);
  const result = { user_id: userId, kind, count: users.length, users };
  console.log(JSON.stringify(result, null, 2));
  if (!noSave) {
    const p = saveData({ account: accountName, task: "follows", suffix: kind, context: ctx, data: result, dir: saveDir });
    console.error(`[follows] saved: ${p}`);
  }
} catch (e) {
  if (e instanceof XSessionError) {
    console.error(formatSessionErrorForCLI(e));
    process.exit(2);
  }
  console.error(`ERROR: ${e.message}`);
  process.exit(1);
}
