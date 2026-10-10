// Threads Insights CLI
//
//   node insights.mjs --account <name>                           # アカウント全体
//   node insights.mjs --account <name> --start 2026-03-27 --end 2026-04-25
//   node insights.mjs --account <name> --post <pk>               # 単一投稿
//   node insights.mjs --account <name> --all-posts               # 自分の全投稿のインプ一覧
//   node insights.mjs --account <name> --all-posts --limit 10
//   node insights.mjs --account <name> --raw                     # 生 JSON 全部
//
// account は --account or env THREADS_ACCOUNT 必須.
import { getAccountInsights, summarizeInsights, getPostInsights, summarizePostInsights } from "./lib/insights.mjs";
import { getUserPosts, getAllUserPosts } from "./lib/user_posts.mjs";
import { getAccount } from "./session.mjs";

const args = process.argv.slice(2);
let accountName = process.env.THREADS_ACCOUNT || null;
let startDate = null, endDate = null, tz = "ASIA_TOKYO";
let raw = false;
let postID = null;
let allPosts = false;
let limit = 50;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--account") { accountName = args[++i]; continue; }
  if (a === "--start") { startDate = args[++i]; continue; }
  if (a === "--end") { endDate = args[++i]; continue; }
  if (a === "--tz") { tz = args[++i]; continue; }
  if (a === "--post") { postID = args[++i]; continue; }
  if (a === "--all-posts") { allPosts = true; continue; }
  if (a === "--limit") { limit = Number(args[++i]); continue; }
  if (a === "--raw") { raw = true; continue; }
}

if (!accountName) {
  console.error("usage: node insights.mjs --account NAME [--start YYYY-MM-DD] [--end YYYY-MM-DD] [--tz ASIA_TOKYO] [--post PK | --all-posts] [--limit N] [--raw]");
  process.exit(1);
}

// per-post insights mode
if (postID) {
  console.log(`[insights] account=${accountName} post=${postID}`);
  const r = await getPostInsights({ accountName, postID });
  console.log(`HTTP ${r.http}`);
  if (raw) console.log(JSON.stringify(r.json, null, 2));
  else     console.log(JSON.stringify(summarizePostInsights(r.json), null, 2));
  process.exit(r.json?.errors ? 1 : 0);
}

// all-posts insights mode (自分の全投稿のインプ一覧)
if (allPosts) {
  const acc = getAccount(accountName);
  const username = acc.username;
  if (!username) { console.error(`account "${accountName}" に username 無し`); process.exit(1); }
  console.log(`[insights] gathering posts for @${username}...`);
  let posts;
  try {
    posts = await getAllUserPosts({ username, accountName, first: 25, maxPages: Math.ceil(limit / 25) });
  } catch (e) {
    // graphql の権限切れ等で失敗 → quick (HTML SSR ~5件) に fallback
    console.error(`[insights] full pagination failed (${e.message.slice(0, 100)}), falling back to --quick`);
    posts = await getUserPosts({ username, accountName });
  }
  posts = posts.slice(0, limit);
  console.log(`[insights] ${posts.length} posts found, fetching insights...`);
  console.log("");

  const rows = [];
  for (let i = 0; i < posts.length; i++) {
    const p = posts[i];
    process.stdout.write(`  [${i+1}/${posts.length}] pk=${p.pk}... `);
    try {
      const r = await getPostInsights({ accountName, postID: p.pk });
      const s = summarizePostInsights(r.json);
      const imp = s?.impressions ?? 0;
      rows.push({
        pk: p.pk,
        code: p.code,
        when: p.taken_at ? new Date(p.taken_at * 1000).toISOString().slice(0, 16).replace("T", " ") : "?",
        text: (p.text || "").slice(0, 40).replace(/\n/g, " "),
        impressions: imp,
        from_followers: s?.impressions_from_followers ?? 0,
        from_non_followers: s?.impressions_from_non_followers ?? 0,
        likes: s?.counts?.likes ?? p.counts?.likes ?? 0,
        replies: s?.counts?.replies ?? p.counts?.replies ?? 0,
        new_follows: s?.new_follows_from_post ?? 0,
      });
      console.log(`imp=${imp}`);
    } catch (e) {
      console.log(`ERR (${e.message.slice(0, 60)})`);
      rows.push({ pk: p.pk, code: p.code, error: e.message });
    }
  }

  if (raw) {
    console.log(JSON.stringify(rows, null, 2));
  } else {
    console.log("");
    console.log(`=== @${username} 投稿別インプ (${rows.length} posts) ===`);
    console.log("");
    const totalImp = rows.reduce((s, r) => s + (r.impressions || 0), 0);
    const totalLikes = rows.reduce((s, r) => s + (r.likes || 0), 0);
    console.log(`日時             |  Imp | Foll | Other |  ❤  | 💬  | +Foll | テキスト`);
    console.log(`-----------------|------|------|-------|-----|-----|-------|---------`);
    for (const r of rows) {
      if (r.error) { console.log(`pk=${r.pk}  ERR: ${r.error.slice(0, 60)}`); continue; }
      console.log(
        `${r.when.padEnd(16)} | ${String(r.impressions).padStart(4)} | ${String(r.from_followers).padStart(4)} | ${String(r.from_non_followers).padStart(5)} | ${String(r.likes).padStart(3)} | ${String(r.replies).padStart(3)} | ${String(r.new_follows).padStart(5)} | ${r.text}`
      );
    }
    console.log("");
    console.log(`合計: ${totalImp} imp / ${totalLikes} likes / ${rows.length} posts`);
  }
  process.exit(0);
}

if (!startDate || !endDate) {
  const today = new Date();
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  endDate = endDate || yesterday.toISOString().slice(0, 10);
  startDate = startDate || new Date(yesterday.getTime() - 29 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

console.log(`[insights] account=${accountName} ${startDate} → ${endDate} tz=${tz}`);
const r = await getAccountInsights({ accountName, startDate, endDate, timeZoneID: tz });
console.log(`HTTP ${r.http}`);
if (raw) {
  console.log(JSON.stringify(r.json, null, 2));
} else {
  console.log(JSON.stringify(summarizeInsights(r.json, { startDate, endDate }), null, 2));
}
process.exit(r.json?.errors ? 1 : 0);
