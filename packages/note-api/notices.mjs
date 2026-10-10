// note お知らせ取得 CLI
//
//   node notices.mjs                       # 直近 12 件
//   node notices.mjs --page 2              # ページ指定
//   node notices.mjs --per 50              # 1 ページ件数
//   node notices.mjs --all --max 5         # 全件 (最大 5 ページ分)
//   node notices.mjs --raw                 # 生 JSON
//   node notices.mjs --filter like         # kind=like のみ
//   node notices.mjs --account personal_dev  # accounts.json から
import { fetchNotices, fetchAllNotices, summarize } from "./lib/notices.mjs";

const args = process.argv.slice(2);
let accountName = process.env.NOTE_ACCOUNT || null;
let page = 1, per = 12, all = false, maxPages = 5, raw = false, filter = null;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--account") accountName = args[++i];
  else if (a === "--page") page = Number(args[++i]);
  else if (a === "--per") per = Number(args[++i]);
  else if (a === "--all") all = true;
  else if (a === "--max") maxPages = Number(args[++i]);
  else if (a === "--raw") raw = true;
  else if (a === "--filter") filter = args[++i];
}

let data;
if (all) {
  data = await fetchAllNotices({ accountName, maxPages, per });
} else {
  const r = await fetchNotices({ accountName, page, per });
  data = r.data;
  if (!raw) console.log(`[notices] page ${r.current_page}/${r.next_page ? `next=${r.next_page}` : "last"}, ${data.length} items`);
}

if (filter) data = data.filter((n) => n.kind === filter);

if (raw) {
  console.log(JSON.stringify(data, null, 2));
  process.exit(0);
}

for (const n of data) {
  const s = summarize(n);
  const when = s.when?.slice(0, 19).replace("T", " ") || "?";
  const mark = s.read ? "  " : "● ";
  const kind = String(s.kind).padEnd(12);
  const actors = s.actors.length ? `@${s.actors.slice(0, 2).join(", @")}${s.actors.length > 2 ? ` +${s.actors.length - 2}` : ""}` : "";
  console.log(`${mark}${when}  ${kind}  ${actors}`);
  console.log(`     ${s.text.slice(0, 90)}`);
  if (s.target_name) console.log(`     → ${s.target_name}`);
  if (s.target_url) console.log(`     ${s.target_url}`);
  console.log();
}
