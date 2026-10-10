// Threads 投稿削除 CLI
//   node delete.mjs --account <name> <pk>
//
// account は --account or env THREADS_ACCOUNT 必須.
import { deletePost } from "./lib/posts.mjs";

const args = process.argv.slice(2);
let accountName = process.env.THREADS_ACCOUNT || null;
const positional = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--account") { accountName = args[++i]; continue; }
  positional.push(a);
}

const mediaId = positional[0];
if (!accountName || !mediaId) {
  console.error("usage: node delete.mjs --account NAME <pk>");
  process.exit(1);
}

console.log(`[delete] account=${accountName} mediaID=${mediaId}`);
const r = await deletePost({ accountName, mediaId });
console.log(`HTTP ${r.http}`);
console.log(JSON.stringify(r.json, null, 2).slice(0, 800));
process.exit(r.json?.errors ? 1 : 0);
