// 収集した恋愛系投稿(posts_raw.json)からアカウントを抽出・集計し、
// 上位アカウントのフォロワー数を SSR から取得して「伸びそう度」を出す。
//   node scripts/threads_account_scout.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dir, "..");
const RAW = path.join(ROOT, "research/2026-06_threads-renai/raw");
const TAPI = path.join(ROOT, "packages/threads-api");

const { getAccount } = await import(path.join(TAPI, "session.mjs"));
const acc = getAccount("me");
const { getUserPosts } = await import(path.join(TAPI, "lib/user_posts.mjs"));

const posts = JSON.parse(fs.readFileSync(path.join(RAW, "posts_raw.json"), "utf8"));

// 1) アカウント単位で集計
const byAcc = new Map();
for (const p of posts) {
  const k = p.user;
  if (!k) continue;
  const a = byAcc.get(k) || { user: k, full_name: p.full_name, verified: p.verified, n: 0, likes: 0, replies: 0, views: 0, max: 0, kws: new Set() };
  a.n++; a.likes += p.like_count || 0; a.replies += p.reply_count || 0; a.views += p.view_count || 0;
  a.max = Math.max(a.max, p.like_count || 0);
  (p._kw || []).forEach((q) => a.kws.add(q));
  byAcc.set(k, a);
}
let accounts = [...byAcc.values()].map((a) => ({ ...a, kws: [...a.kws], avg: Math.round(a.likes / a.n) }))
  .sort((x, y) => y.likes - x.likes);

// 2) 上位アカウントの「直近投稿の安定感」を取得（一発屋でないか＝伸びそう度）
const median = (xs) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };

const TOP = Math.min(15, accounts.length);
for (let i = 0; i < TOP; i++) {
  const a = accounts[i];
  try {
    const recent = await getUserPosts({ accountName: "me", username: a.user });
    const likes = (recent || []).map((p) => p.counts?.likes ?? p.like_count ?? 0).filter((x) => x > 0);
    a.recent_n = likes.length;
    a.recent_median = median(likes);
    a.recent_max = likes.length ? Math.max(...likes) : 0;
    // 伸びそう度: 直近投稿の中央値いいね（継続的に刺さってるか）
    a.momentum = a.recent_median;
  } catch (e) {
    a.recent_n = 0; a.recent_median = null; a.momentum = 0;
  }
  await new Promise((r) => setTimeout(r, 700 + Math.random() * 700)); // jitter
}

fs.writeFileSync(path.join(RAW, "accounts.json"), JSON.stringify(accounts, null, 1));

// 3) 出力
console.log(`\n=== 恋愛系アカウント ${accounts.length}人 / サンプル投稿 ${posts.length}件 ===`);
console.log("(サンプル=失恋/復縁/恋愛相談/片思い/元カレ の伸びてる投稿の発信者)\n");
console.log("rank  bestPost❤  直近中央値  直近n  account            ジャンル");
accounts.slice(0, TOP).forEach((a, i) => {
  const med = a.recent_median == null ? " ? " : String(a.recent_median).padStart(6);
  console.log(
    String(i + 1).padStart(3) + ".  " + String(a.max).padStart(7) + "  " +
    med + "      " + String(a.recent_n ?? 0).padStart(2) + "    @" +
    a.user.padEnd(18) + " " + a.kws.join(",")
  );
});

// 伸びそう = 直近投稿の中央値いいねが高い（バズが単発でなく継続している）
const promising = accounts.slice(0, TOP)
  .filter((a) => a.recent_n >= 3 && a.recent_median > 0)
  .sort((x, y) => y.recent_median - x.recent_median).slice(0, 8);
console.log("\n=== 🔥 伸びそう (直近投稿も継続して刺さってる＝モメンタム高) ===");
promising.forEach((a, i) => console.log(`${i + 1}. @${a.user}  直近中央値❤${a.recent_median}（直近${a.recent_n}件）  bestPost❤${a.max}  [${a.kws.join(",")}]`));
