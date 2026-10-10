// Threads リポスト CLI
//
//   node repost.mjs --account <name> <pk>
//   node repost.mjs --account <name> <pk>_<author_user_id>
//
// account は --account or env THREADS_ACCOUNT 必須.
import { repost } from "./lib/reposts.mjs";

const args = process.argv.slice(2);
let accountName = process.env.THREADS_ACCOUNT || null;
const positional = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--account") { accountName = args[++i]; continue; }
  positional.push(a);
}

const mediaRef = positional[0];
if (!accountName) {
  console.error("ERROR: --account <name> または env THREADS_ACCOUNT が必要");
  process.exit(1);
}
if (!mediaRef) {
  console.error("usage: node repost.mjs --account NAME <pk|strong_id>");
  process.exit(1);
}

console.log(`[repost] account=${accountName}  ref=${mediaRef}`);
const r = await repost({ accountName, mediaRef });

if (r.http === 200 && !r.json?.errors) {
  console.log(`OK  HTTP ${r.http}`);
  console.log(JSON.stringify(r.json, null, 2).slice(0, 600));
  process.exit(0);
}
console.error(`FAIL  HTTP ${r.http}`);
console.error(JSON.stringify(r.json).slice(0, 600));
process.exit(1);
