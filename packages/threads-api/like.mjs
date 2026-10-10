// Threads いいね CLI
//
//   node like.mjs --account <name> <pk|shortcode|permalink_url>
//   node like.mjs --account <name> --unlike <ref>
//
// account は --account or env THREADS_ACCOUNT 必須.
import { likePost, unlikePost } from "./lib/likes.mjs";

const args = process.argv.slice(2);
let accountName = process.env.THREADS_ACCOUNT || null;
let unlike = false;
const positional = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--account") { accountName = args[++i]; continue; }
  if (a === "--unlike") { unlike = true; continue; }
  positional.push(a);
}

const mediaRef = positional[0];
if (!accountName) {
  console.error("ERROR: --account <name> または env THREADS_ACCOUNT が必要");
  process.exit(1);
}
if (!mediaRef) {
  console.error("usage: node like.mjs --account NAME [--unlike] <pk|shortcode|permalink_url>");
  process.exit(1);
}

const action = unlike ? "unlike" : "like";
console.log(`[${action}] account=${accountName}  ref=${mediaRef}`);

const fn = unlike ? unlikePost : likePost;
const r = await fn({ accountName, mediaRef });

if (r.http === 200 && (r.json?.status === "ok" || r.json?.likes_count !== undefined)) {
  console.log(`OK  status=${r.json.status}  likes=${r.json.likes_count ?? "?"}`);
  process.exit(0);
}

console.error(`FAIL  HTTP ${r.http}`);
console.error(JSON.stringify(r.json).slice(0, 600));
process.exit(1);
