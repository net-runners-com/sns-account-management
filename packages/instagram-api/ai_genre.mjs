// Instagram「AIジャンル」投稿コレクター
//
//   node ai_genre.mjs --account <n> [--tags a,b,c] [--per 40] [--top 30] [--min-likes N]
//
// 複数の AI 系ハッシュタグを横断して top 投稿を集め、code で重複排除し、
// エンゲージメント (like+comment) 順にランキング。reports/ に JSON + Markdown を保存。
import { igFetch } from "./lib/http.mjs";
import { writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
let accountName = process.env.INSTAGRAM_ACCOUNT || null;
let tagsArg = null, per = 40, top = 30, minLikes = 0;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--account") accountName = args[++i];
  else if (a === "--tags") tagsArg = args[++i];
  else if (a === "--per") per = Number(args[++i]);
  else if (a === "--top") top = Number(args[++i]);
  else if (a === "--min-likes") minLikes = Number(args[++i]);
}
if (!accountName) { console.error("usage: node ai_genre.mjs --account NAME [--tags a,b] [--per N] [--top N]"); process.exit(1); }

// デフォルト: 日本語 AI ジャンルの定番タグ + グローバル ai
const DEFAULT_TAGS = ["ai", "生成ai", "chatgpt", "ai活用", "aiツール", "ai副業"];
const tags = (tagsArg ? tagsArg.split(",") : DEFAULT_TAGS).map(t => t.trim().replace(/^#/, "")).filter(Boolean);

const fmt = (n) => (n ?? 0).toLocaleString("en-US");
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function extractMedias(sections) {
  const out = [];
  for (const s of sections || []) {
    const lc = s.layout_content || {};
    const buckets = [lc.medias, lc.fill_items, lc.one_by_two_item?.clips?.items].filter(Boolean);
    for (const b of buckets) for (const it of b) { const m = it.media || it; if (m?.code) out.push(m); }
  }
  return out;
}

async function fetchTag(tag) {
  const collected = [];
  let count = 0;
  try {
    const { json } = await igFetch(accountName, `/api/v1/tags/web_info/?tag_name=${encodeURIComponent(tag)}`);
    count = json?.count || 0;
    collected.push(...extractMedias(json?.data?.top?.sections));
    let maxId = json?.data?.top?.next_max_id || json?.next_max_id, page = 0;
    while (collected.length < per && maxId && page < 10) {
      const body = `include_persistent=true&max_id=${encodeURIComponent(maxId)}&tab=top`;
      const r = await igFetch(accountName, `/api/v1/tags/${encodeURIComponent(tag)}/sections/`, { method: "POST", body });
      const more = extractMedias(r.json?.sections);
      if (!more.length) break;
      collected.push(...more);
      maxId = r.json?.next_max_id; page++;
      await sleep(700 + Math.random() * 400);
    }
  } catch (e) {
    process.stderr.write(`\n[#${tag}] ERROR: ${e.message}\n`);
  }
  return { tag, count, medias: collected.slice(0, per) };
}

console.error(`AIジャンル収集: tags=[${tags.join(", ")}] per=${per} top=${top}`);
const byCode = new Map();
const tagStats = [];
for (const tag of tags) {
  const r = await fetchTag(tag);
  tagStats.push({ tag: r.tag, totalPosts: r.count, fetched: r.medias.length });
  for (const m of r.medias) {
    const code = m.code;
    if (!byCode.has(code)) byCode.set(code, { m, tags: new Set() });
    byCode.get(code).tags.add(tag);
  }
  process.stderr.write(`  #${tag}: ${fmt(r.count)} posts総数 → ${r.medias.length}件取得 (累計uniq ${byCode.size})\n`);
  await sleep(800 + Math.random() * 500);
}

const rows = [...byCode.values()].map(({ m, tags }) => {
  const likes = m.like_count ?? 0, comments = m.comment_count ?? 0;
  const views = m.play_count || m.ig_play_count || 0;
  return {
    code: m.code,
    url: `https://www.instagram.com/p/${m.code}/`,
    username: m.user?.username || "?",
    verified: !!m.user?.is_verified,
    type: m.media_type === 2 ? "reel/video" : (m.carousel_media_count ? `carousel x${m.carousel_media_count}` : "image"),
    taken_at: m.taken_at ? new Date(m.taken_at * 1000).toISOString().slice(0, 16).replace("T", " ") : null,
    like_count: likes,
    comment_count: comments,
    play_count: views,
    engagement: likes + comments,
    caption: (m.caption?.text || "").replace(/\s+/g, " ").trim(),
    matched_tags: [...tags],
  };
}).filter(r => r.like_count >= minLikes)
  .sort((a, b) => b.engagement - a.engagement);

const ranked = rows.slice(0, top);

// ---- console ----
console.log(`\n=== AIジャンル Instagram 投稿 TOP ${ranked.length} (uniq ${rows.length}件中) ===\n`);
ranked.forEach((r, i) => {
  console.log(`${String(i + 1).padStart(2)}. @${r.username}${r.verified ? " ✔" : ""}  ❤${fmt(r.like_count)} 💬${fmt(r.comment_count)}${r.play_count ? ` ▶${fmt(r.play_count)}` : ""}  [${r.type}]`);
  console.log(`    ${r.caption.slice(0, 70)}`);
  console.log(`    ${r.url}  (#${r.matched_tags.join(" #")})  ${r.taken_at || ""}`);
});

// ---- save ----
const reportsDir = resolve(__dirname, "../../reports");
mkdirSync(reportsDir, { recursive: true });
const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
const base = `ig_ai_genre_${stamp}`;
const payload = { generatedAt: new Date().toISOString(), account: accountName, tags, tagStats, uniqueCount: rows.length, posts: rows };
writeFileSync(resolve(reportsDir, `${base}.json`), JSON.stringify(payload, null, 2));

const md = [
  `# Instagram「AIジャンル」投稿コレクション`,
  ``,
  `- 取得日時: ${payload.generatedAt}`,
  `- アカウント: ${accountName}`,
  `- 対象タグ: ${tags.map(t => "#" + t).join(" ")}`,
  `- ユニーク投稿数: ${rows.length}`,
  ``,
  `## タグ別`,
  ``,
  `| タグ | 投稿総数 | 取得数 |`,
  `|---|--:|--:|`,
  ...tagStats.map(s => `| #${s.tag} | ${fmt(s.totalPosts)} | ${s.fetched} |`),
  ``,
  `## エンゲージメント TOP ${ranked.length}`,
  ``,
  `| # | アカウント | ❤ | 💬 | ▶ | 種別 | タグ | URL |`,
  `|--:|---|--:|--:|--:|---|---|---|`,
  ...ranked.map((r, i) => `| ${i + 1} | @${r.username}${r.verified ? " ✔" : ""} | ${fmt(r.like_count)} | ${fmt(r.comment_count)} | ${r.play_count ? fmt(r.play_count) : "-"} | ${r.type} | ${r.matched_tags.map(t => "#" + t).join(" ")} | ${r.url} |`),
  ``,
  `## キャプション抜粋`,
  ``,
  ...ranked.map((r, i) => `${i + 1}. **@${r.username}** (❤${fmt(r.like_count)})\n   > ${r.caption.slice(0, 200) || "(キャプションなし)"}\n   ${r.url}`),
].join("\n");
writeFileSync(resolve(reportsDir, `${base}.md`), md);

console.log(`\n💾 保存: reports/${base}.json / ${base}.md`);
