// シャドウバン検知 CLI
//
// 使い方:
//   node --env-file=.env shadowban_check.mjs                         # env THREADS_ACCOUNT を対象
//   node shadowban_check.mjs --account account2                 # 自分の account でセルフチェック
//   node shadowban_check.mjs --account account2 --via myaccount  # 別 account で検索可視性確認
//
// チェック項目:
//   1. 別アカウントで username 検索 → 出るか? (shadowban の典型症状)
//   2. 直近1週間のインプ vs それ以前 平均 → 30% 以下なら確定
//   3. 結果サマリ出力 (ALIVE / SUSPECT / CONFIRMED)
import { searchUsers } from "./lib/user_search.mjs";
import { getPostInsights, summarizePostInsights } from "./lib/insights.mjs";
import { getAllUserPosts } from "./lib/user_posts.mjs";
import { getAccount } from "./session.mjs";

const args = process.argv.slice(2);
let accountName = process.env.THREADS_ACCOUNT || null;
let viaAccount = null;
let recentDays = 7;
let raw = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--account") accountName = args[++i];
  else if (args[i] === "--via") viaAccount = args[++i];
  else if (args[i] === "--recent-days") recentDays = Number(args[++i]);
  else if (args[i] === "--raw") raw = true;
}
if (!accountName) {
  console.error("ERROR: --account or env THREADS_ACCOUNT 必須");
  process.exit(1);
}
const acc = getAccount(accountName);
const username = acc.username;
if (!username) { console.error(`account '${accountName}' に username なし`); process.exit(1); }

const report = {
  target: { account: accountName, username },
  via_account: viaAccount,
  search_visibility: { checked: false, found: null, notes: null },
  impression_analysis: { checked: false, recent_avg: null, baseline_avg: null, ratio: null, status: null, posts: [] },
  verdict: "UNKNOWN",
};

// === 1. 検索可視性 (別 account から自分を検索) ===
if (viaAccount) {
  console.log(`[1/2] 別 account "${viaAccount}" で @${username} をユーザー検索中...`);
  try {
    const { users } = await searchUsers({ accountName: viaAccount, query: username, first: 10 });
    const target = username.toLowerCase();
    const found = users.find((u) => String(u.username).toLowerCase() === target);
    report.search_visibility.checked = true;
    report.search_visibility.found = !!found;
    report.search_visibility.results_count = users.length;
    report.search_visibility.candidate_usernames = users.map((u) => u.username);
    console.log(`     結果 ${users.length}件: [${users.map((u) => u.username).slice(0, 6).join(", ")}${users.length > 6 ? "..." : ""}]`);
    console.log(`     対象 @${username} ヒット: ${found ? "✅ あり" : "❌ なし"}`);
  } catch (e) {
    report.search_visibility.notes = `search failed: ${e.message}`;
    console.log(`     ⚠ ${e.message}`);
  }
} else {
  console.log(`[1/2] --via で別 account 指定すれば検索可視性チェック可能 (skip)`);
}

// === 2. インプ分析 (直近 vs ベースライン) ===
console.log(`[2/2] @${username} の投稿インプ取得中...`);
const posts = await getAllUserPosts({ username, accountName, first: 25, maxPages: 4 }).catch((e) => {
  console.log(`     posts fetch failed: ${e.message}`);
  return [];
});
console.log(`     ${posts.length} posts 取得`);

const now = Date.now() / 1000;
const recentCutoff = now - recentDays * 86400;
const recentPosts = [];
const baselinePosts = [];

for (const p of posts) {
  if (!p.taken_at) continue;
  if (p.taken_at >= recentCutoff) recentPosts.push(p);
  else baselinePosts.push(p);
}
console.log(`     recent (≤${recentDays}d): ${recentPosts.length} posts | baseline: ${baselinePosts.length} posts`);

async function fetchImpressions(plist) {
  const out = [];
  for (const p of plist) {
    try {
      const r = await getPostInsights({ accountName, postID: p.pk });
      const imp = summarizePostInsights(r.json)?.impressions ?? 0;
      out.push({ pk: p.pk, code: p.code, taken_at: p.taken_at, impressions: imp, text: (p.text || "").slice(0, 40) });
    } catch (e) {
      out.push({ pk: p.pk, error: e.message });
    }
  }
  return out;
}

console.log("     直近 投稿の Insights 取得中...");
const recentRows = await fetchImpressions(recentPosts);
console.log("     baseline Insights 取得中...");
const baselineRows = await fetchImpressions(baselinePosts.slice(0, 14));  // 上限 14 件まで

const recentValid = recentRows.filter(r => typeof r.impressions === "number");
const baselineValid = baselineRows.filter(r => typeof r.impressions === "number");
const recentAvg = recentValid.length ? recentValid.reduce((s, r) => s + r.impressions, 0) / recentValid.length : 0;
const baselineAvg = baselineValid.length ? baselineValid.reduce((s, r) => s + r.impressions, 0) / baselineValid.length : 0;
const ratio = baselineAvg > 0 ? recentAvg / baselineAvg : null;

report.impression_analysis.checked = true;
report.impression_analysis.recent_count = recentValid.length;
report.impression_analysis.baseline_count = baselineValid.length;
report.impression_analysis.recent_avg = Math.round(recentAvg);
report.impression_analysis.baseline_avg = Math.round(baselineAvg);
report.impression_analysis.ratio = ratio !== null ? Number(ratio.toFixed(3)) : null;
report.impression_analysis.posts = { recent: recentRows, baseline: baselineRows };

let impStatus = "INSUFFICIENT_DATA";
if (recentValid.length >= 1 && baselineValid.length >= 3) {
  if (ratio !== null && ratio < 0.3) impStatus = "CONFIRMED";        // 30% 以下 → 確定
  else if (ratio !== null && ratio < 0.5) impStatus = "SUSPECT";      // 30〜50% → 疑い
  else impStatus = "OK";
}
report.impression_analysis.status = impStatus;

// === 総合判定 ===
let verdict = "UNKNOWN";
if (impStatus === "CONFIRMED") verdict = "CONFIRMED_SHADOWBAN";
else if (impStatus === "SUSPECT") verdict = "SUSPECT_SHADOWBAN";
else if (impStatus === "OK" && (!report.search_visibility.checked || report.search_visibility.found)) verdict = "ALIVE";
else if (report.search_visibility.checked && report.search_visibility.found === false) verdict = "SUSPECT_SHADOWBAN";
report.verdict = verdict;

// === 出力 ===
if (raw) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log("");
  console.log(`╔════════════════════════════════════════════════╗`);
  console.log(`║ シャドウバン検知レポート: @${username}`);
  console.log(`╚════════════════════════════════════════════════╝`);
  console.log(`【検索可視性】 ${
    report.search_visibility.checked
      ? (report.search_visibility.found ? "✅ 検索結果に出る" : "❌ 検索に出ない (バンの可能性)")
      : "⏭ skip (--via 指定なし)"
  }`);
  console.log(`【インプ比較】 直近${recentDays}日: ${recentValid.length}件 平均${Math.round(recentAvg)}imp / それ以前: ${baselineValid.length}件 平均${Math.round(baselineAvg)}imp`);
  if (ratio !== null) {
    const pct = (ratio * 100).toFixed(0) + "%";
    console.log(`              比率: ${pct}  → ${impStatus}`);
  }
  console.log("");
  console.log(`╔════════════════════════════════════════════════╗`);
  console.log(`║ 判定: ${verdict}`);
  console.log(`╚════════════════════════════════════════════════╝`);

  if (verdict === "CONFIRMED_SHADOWBAN" || verdict === "SUSPECT_SHADOWBAN") {
    console.log("");
    console.log("対処手順:");
    console.log("  ① 心当たり停止: 外部リンク連投 / 大量フォロー / コピペ投稿");
    console.log(`  ② 48〜72時間 投稿頻度を 1日1〜2本に. テキストのみに`);
    console.log("  ③ 回復後、外部リンクはコメント欄に");
  }
}

process.exit(0);
