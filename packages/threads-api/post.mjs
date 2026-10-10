// Threads 投稿 CLI (テキスト / 画像 / 投票 / 返信)
//
// テキスト:
//   node post.mjs --account <name> "投稿テキスト"
//   node post.mjs --account <name> --reply-to <pk> "返信"
//   node post.mjs --account <name> --reply-control 1 "テキスト"   # 0=everyone, 1=mentioned_only, 2=followed
//
// 画像 (jpg/png ローカル path):
//   node post.mjs --account <name> --image /path/to/photo.jpg "キャプション"
//   node post.mjs --account <name> --image photo.jpg                # キャプションなしも OK
//
// カルーセル投稿 (--image を 2 個以上指定):
//   node post.mjs --account <name> --image a.jpg --image b.jpg "キャプション"
//
// ネタバレ画像 (--spoiler でブラー):
//   node post.mjs --account <name> --image f.jpg --spoiler "閲覧注意"
//
// 引用投稿 (--quote で他投稿の pk を引用):
//   node post.mjs --account <name> --quote 3884316646949767936 "コメント"
//   node post.mjs --account <name> --quote https://www.threads.com/@user/post/CODE "コメント"
//
// トピック投稿 (--topic で投稿に topic タグを付ける):
//   node post.mjs --account <name> --topic "冬の朝" "今朝寒すぎる"
//
// GIF 投稿 (--gif で Giphy ID を指定. Threads は Giphy のショート ID を使う):
//   node post.mjs --account <name> --gif VxKc8P17C1ZqRMTrrl "コメント"
//   node post.mjs --account <name> --gif <id>  # キャプションなしも OK
//   ※ Giphy ID は giphy.com の URL 末尾 (例: giphy.com/gifs/abc-VxKc8P17C1ZqRMTrrl の末尾)
//
// 投票 (--poll で複数回 choice 指定. question は positional text):
//   node post.mjs --account <name> --poll "選択肢1" --poll "選択肢2" "投票の質問"
//
// 添付テキスト (snippet, 長文 rich-text):
//   node post.mjs --account <name> --snippet "<長文ここに>" "短いキャプション"
//
// ツリー投稿 (連続自己 reply, 同じ context で繋がる):
//   node post.mjs --account <name> --chain "1件目" --chain "2件目" --chain "3件目"
//
// account は --account or env THREADS_ACCOUNT 必須.
import { createTextPost, createPhotoPost, createCarouselPost, createThreadChain } from "./lib/posts.mjs";

const args = process.argv.slice(2);
let accountName = process.env.THREADS_ACCOUNT || null;
let replyControl = 0;
let replyToId = null;
const imagePaths = [];
let snippet = null;
let spoiler = false;
let quotedPostId = null;
let topic = null;
let gifMediaId = null;
const pollChoices = [];
const chain = [];
const positional = [];

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--account") { accountName = args[++i]; continue; }
  if (a === "--reply-control") { replyControl = parseInt(args[++i], 10); continue; }
  if (a === "--reply-to") { replyToId = args[++i]; continue; }
  if (a === "--image") { imagePaths.push(args[++i]); continue; }
  if (a === "--poll") { pollChoices.push(args[++i]); continue; }
  if (a === "--snippet") { snippet = args[++i]; continue; }
  if (a === "--chain") { chain.push(args[++i]); continue; }
  if (a === "--spoiler") { spoiler = true; continue; }
  if (a === "--quote") { quotedPostId = args[++i]; continue; }
  if (a === "--topic") { topic = args[++i]; continue; }
  if (a === "--gif") { gifMediaId = args[++i]; continue; }
  positional.push(a);
}
const imagePath = imagePaths[0] || null;

const text = positional.join(" ").trim();
if (!accountName) {
  console.error("ERROR: --account <name> または env THREADS_ACCOUNT が必要");
  process.exit(1);
}
if (!text && !imagePath && pollChoices.length === 0 && !snippet && chain.length === 0 && !quotedPostId && !gifMediaId) {
  console.error('usage:');
  console.error('  text:    node post.mjs --account NAME "<text>"');
  console.error('  photo:   node post.mjs --account NAME --image <path> ["caption"]');
  console.error('  poll:    node post.mjs --account NAME --poll "A" --poll "B" "<question>"');
  console.error('  snippet: node post.mjs --account NAME --snippet "<長文>" ["caption"]');
  console.error('  chain:   node post.mjs --account NAME --chain "1件目" --chain "2件目" --chain "3件目"');
  process.exit(1);
}
if (pollChoices.length > 0 && pollChoices.length < 2) {
  console.error("ERROR: poll requires at least 2 --poll choices");
  process.exit(1);
}

// ツリー投稿は単独モード (他フラグ無視)
if (chain.length >= 2) {
  console.log(`[post] account=${accountName}  chain[${chain.length}]`);
  const r = await createThreadChain({ accountName, posts: chain });
  console.log(`OK  ${r.pks.length} posts in thread (ctx=${r.contextId})`);
  for (let i = 0; i < r.pks.length; i++) {
    console.log(`  ${i + 1}. pk=${r.pks[i]}  https://www.threads.com/@${process.env.THREADS_USERNAME?.replace(/^@/, "") || ""}/post/${r.codes[i]}`);
  }
  process.exit(0);
}
if (chain.length === 1) {
  console.error("ERROR: chain は --chain 2 個以上必要 (単発投稿は通常通り text 引数で)");
  process.exit(1);
}

const isPoll = pollChoices.length >= 2;
const isCarousel = imagePaths.length >= 2;
const mode = replyToId ? `reply→${replyToId}` : (isCarousel ? `carousel[${imagePaths.length}]` : (imagePath ? "photo" : (isPoll ? `poll[${pollChoices.length}]` : (snippet ? `snippet[${snippet.length}]` : "new"))));
console.log(`[post] account=${accountName}  ${mode}  ${imagePath ? `image="${imagePath}" ` : ""}text="${text.slice(0, 60)}${text.length > 60 ? "..." : ""}"  (${text.length} chars)`);

const r = isCarousel
  ? await createCarouselPost({ accountName, imagePaths, text, replyControl, replyToId, spoiler })
  : (imagePath
    ? await createPhotoPost({ accountName, imagePath, text, replyControl, replyToId, spoiler })
    : await createTextPost({
        accountName, text, replyControl, replyToId,
        ...(isPoll ? { poll: { question: text, choices: pollChoices } } : {}),
        ...(snippet ? { snippet } : {}),
        ...(quotedPostId ? { quotedPostId } : {}),
        ...(topic ? { topic } : {}),
        ...(gifMediaId ? { gifMediaId } : {}),
      }));

if (r.json?.media?.id) {
  const m = r.json.media;
  console.log(`OK  pk=${m.pk}  code=${m.code}`);
  console.log(`URL: ${m.permalink}`);
  process.exit(0);
}

console.error(`FAIL  HTTP ${r.http}`);
console.error(JSON.stringify(r.json).slice(0, 600));
process.exit(1);
