// X 手動再ログイン CLI (debug 用. 通常は xFetch が auto-relogin する)
//
//   X_LOGIN_USERNAME_HIROTOHIROTO_X=net_runners__ \
//   X_LOGIN_PASSWORD_HIROTOHIROTO_X=xxxxx \
//   node libs/x-api/login.mjs --account hirotohiroto_x
import { reloginAccount } from "./lib/auto_relogin.mjs";

const args = process.argv.slice(2);
let accountName = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--account") accountName = args[++i];
}
if (!accountName) {
  console.error("usage: node login.mjs --account <name>");
  console.error("env: X_LOGIN_USERNAME_<NAME>=... X_LOGIN_PASSWORD_<NAME>=...");
  process.exit(1);
}

try {
  const acc = await reloginAccount(accountName);
  console.log(`✅ logged in. user_id=${acc.user_id} screen_name=${acc.screen_name || "?"}`);
} catch (e) {
  console.error(`FAIL: ${e.message}`);
  if (e.stage) console.error(`  stage: ${e.stage}`);
  process.exit(1);
}
