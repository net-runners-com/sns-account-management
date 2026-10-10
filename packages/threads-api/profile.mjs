// プロフィール取得 CLI
//
//   node profile.mjs --account <name> <username>          # 整形 summary
//   node profile.mjs --account <name> <username> --raw    # 全 field 生 JSON
//
// account は --account or env THREADS_ACCOUNT 必須 (instagrapi-bridge 経由のため).
// .env: THREADS_USERNAME / THREADS_PASSWORD (初回 login 時のみ)
import { getProfile, summarizeProfile } from "./lib/profile.mjs";

const args = process.argv.slice(2);
let account = process.env.THREADS_ACCOUNT || null;
let raw = false;
const positional = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--account") { account = args[++i]; continue; }
  if (a === "--raw") { raw = true; continue; }
  positional.push(a);
}

const username = positional[0];
if (!account) {
  console.error("ERROR: --account <name> または env THREADS_ACCOUNT が必要");
  process.exit(1);
}
if (!username) {
  console.error("usage: node profile.mjs --account NAME [--raw] <username>");
  process.exit(1);
}

try {
  const p = await getProfile({ username, account });
  if (raw) {
    console.log(JSON.stringify(p, null, 2));
  } else {
    console.log(JSON.stringify(summarizeProfile(p), null, 2));
  }
} catch (e) {
  console.error("ERROR:", e.message);
  process.exit(1);
}
