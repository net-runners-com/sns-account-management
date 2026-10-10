// X セッション生死確認
//   node check_session.mjs --account hirotohiroto_x
import { getAccount } from "./session.mjs";
import { getProfileByRestId } from "./lib/profile.mjs";
import { XSessionError, formatSessionErrorForCLI } from "./lib/errors.mjs";

const args = process.argv.slice(2);
let accountName = process.env.X_ACCOUNT || null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--account") accountName = args[++i];
}
if (!accountName) {
  console.error("usage: node check_session.mjs --account <name>");
  process.exit(1);
}

try {
  const acc = getAccount(accountName);
  const p = await getProfileByRestId(acc, { userId: acc.user_id, accountName });
  if (!p?.user_id) {
    console.error("FAIL: profile parse 失敗");
    process.exit(1);
  }
  console.log(
    `OK: session alive (${accountName}) — @${p.screen_name}  followers=${p.followers_count}  following=${p.following_count}  tweets=${p.tweets_count}`
  );
} catch (e) {
  if (e instanceof XSessionError) {
    console.error(formatSessionErrorForCLI(e));
    process.exit(2);
  }
  console.error(`FAIL: ${e.message}`);
  process.exit(1);
}
