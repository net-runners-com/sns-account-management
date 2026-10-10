// X ユーザープロフィール取得 CLI
//   node profile.mjs --account <name>                   # 自分
//   node profile.mjs --account <name> --user-id <id>    # ID 指定
//   node profile.mjs --account <name> --screen-name <handle>
//   node profile.mjs --account <name> --raw             # 生 JSON
import { getAccount } from "./session.mjs";
import { getProfileByRestId, getProfileByScreenName } from "./lib/profile.mjs";
import { XSessionError, formatSessionErrorForCLI } from "./lib/errors.mjs";
import { saveData, parseSaveFlags } from "./lib/save.mjs";

const { noSave, saveDir, remaining: args } = parseSaveFlags(process.argv.slice(2));
let accountName = process.env.X_ACCOUNT || null;
let userId = null, screenName = null, raw = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--account") { accountName = args[++i]; continue; }
  if (a === "--user-id") { userId = args[++i]; continue; }
  if (a === "--screen-name") { screenName = args[++i].replace(/^@/, ""); continue; }
  if (a === "--raw") { raw = true; continue; }
}
if (!accountName) {
  console.error("usage: node profile.mjs --account <name> [--user-id <id>|--screen-name <h>] [--raw] [--no-save] [--save-dir <path>]");
  process.exit(1);
}

try {
  const acc = getAccount(accountName);
  if (!userId && !screenName) userId = acc.user_id;
  const p = userId
    ? await getProfileByRestId(acc, { userId, accountName, raw })
    : await getProfileByScreenName(acc, { screenName, accountName, raw });
  if (!p) {
    console.error("user not found");
    process.exit(1);
  }
  console.log(JSON.stringify(p, null, 2));
  if (!noSave) {
    const ctx = screenName || userId;
    const path = saveData({ account: accountName, task: "profile", context: ctx, data: p, dir: saveDir, suffix: raw ? "raw" : undefined });
    console.error(`[profile] saved: ${path}`);
  }
} catch (e) {
  if (e instanceof XSessionError) {
    console.error(formatSessionErrorForCLI(e));
    process.exit(2);
  }
  console.error(`ERROR: ${e.message}`);
  process.exit(1);
}
