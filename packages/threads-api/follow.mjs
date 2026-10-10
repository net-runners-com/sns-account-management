// Threads フォロー CLI
//
//   node follow.mjs --account <name> --target <user_id>
//   node follow.mjs --account <name> --target-username <username>
//
// account は --account or env THREADS_ACCOUNT 必須.
import { followUser } from "./lib/follows.mjs";
import { httpFetch } from "./lib/fingerprint.mjs";
import { browserHeaders } from "./lib/http.mjs";
import { getAccount } from "./session.mjs";

const args = process.argv.slice(2);
let accountName = process.env.THREADS_ACCOUNT || null;
let targetId = null;
let targetUsername = null;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--account") { accountName = args[++i]; continue; }
  if (a === "--target") { targetId = args[++i]; continue; }
  if (a === "--target-username") { targetUsername = args[++i]; continue; }
}

// username → Threads ds_user_id (HTML scrape)
async function resolveUserId(username) {
  const acc = getAccount(accountName);
  const r = await httpFetch(`https://www.threads.com/@${username}`, {
    headers: browserHeaders({
      Accept: "text/html",
      Cookie: acc.cookies,
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Upgrade-Insecure-Requests": "1",
    }),
    redirect: "manual",
  });
  const html = await r.text();
  const m = html.match(new RegExp(`"pk":"(\\d+)","text_post_app_is_private":[^,]+,"username":"${username}"`));
  if (m) return m[1];
  // fallback
  const m2 = html.match(/"pk":"(\d{10,15})"/);
  if (m2) return m2[1];
  throw new Error(`could not resolve user_id for @${username}`);
}

if (!accountName) {
  console.error("ERROR: --account <name> または env THREADS_ACCOUNT が必要");
  process.exit(1);
}
if (!targetId && !targetUsername) {
  console.error("usage: node follow.mjs --account NAME (--target USER_ID | --target-username USERNAME)");
  process.exit(1);
}

if (!targetId) {
  console.log(`[follow] resolving username @${targetUsername} → user_id...`);
  targetId = await resolveUserId(targetUsername);
  console.log(`[follow]   → ${targetId}`);
}

console.log(`[follow] account=${accountName}  target=${targetId}`);
const r = await followUser({ accountName, targetUserId: targetId });

console.log(`HTTP ${r.http}`);
console.log(JSON.stringify(r.json, null, 2).slice(0, 600));
process.exit(r.json?.errors ? 1 : 0);
