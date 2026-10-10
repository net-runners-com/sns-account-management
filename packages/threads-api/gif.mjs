// GIF 検索 CLI (Giphy via Threads picker)
//
//   node gif.mjs <query>                  # 検索結果一覧
//   node gif.mjs <query> --raw            # 生 JSON
//   node gif.mjs <query> | head -1        # 一番上の GIF ID 取り出し → post.mjs --gif
//
// 例:
//   ID=$(node gif.mjs cat | jq -r '.items[0].gif_media_id')
//   node post.mjs --gif "$ID" "猫だよ"
import { searchGifs } from "./lib/gif.mjs";

const args = process.argv.slice(2);
let accountName = process.env.THREADS_ACCOUNT || null;
let raw = false;
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--account") accountName = args[++i];
  else if (args[i] === "--raw") raw = true;
  else positional.push(args[i]);
}
const query = positional.join(" ").trim();
if (!accountName) { console.error("ERROR: --account or env THREADS_ACCOUNT required"); process.exit(1); }
if (!query) { console.error("usage: node gif.mjs <query>"); process.exit(1); }

const r = await searchGifs({ accountName, query });
if (raw) console.log(JSON.stringify(r, null, 2));
else {
  console.log(`[gif] query="${query}"  ${r.items.length} results`);
  for (const it of r.items.slice(0, 20)) {
    console.log(`  id=${it.gif_media_id}  ${it.url || ""}`);
  }
  console.log(JSON.stringify({ items: r.items }, null, 2));
}
