// Instagram 投稿のメディア (動画/画像) URL 解決 & ダウンロード CLI
//
//   node media.mjs --account <n> <url|shortcode>             # メディアURL解決 (表示のみ)
//   node media.mjs --account <n> <url|shortcode> --download  # mp4/jpg を保存
//   node media.mjs --account <n> --from posts.txt --download # ファイル内の全URLを一括DL
//   node media.mjs --account <n> <code> --out ./dl           # 保存先ディレクトリ
//
// 流れ: shortcode → media_id (base64 decode) → media/{id}/info → video_versions/image_versions
import { igFetch } from "./lib/http.mjs";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "fs";
import { join } from "path";

const AB = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
function codeToId(code) { let n = 0n; for (const c of code) { const i = AB.indexOf(c); if (i < 0) break; n = n * 64n + BigInt(i); } return n.toString(); }
function parseCode(s) { const m = String(s).match(/\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/); return m ? m[1] : s.replace(/^@/, ""); }

const args = process.argv.slice(2);
let accountName = process.env.INSTAGRAM_ACCOUNT || null;
let download = false, outDir = join(process.cwd(), "ig_media"), fromFile = null;
const positional = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--account") accountName = args[++i];
  else if (a === "--download" || a === "-d") download = true;
  else if (a === "--out") outDir = args[++i];
  else if (a === "--from") fromFile = args[++i];
  else positional.push(a);
}
if (!accountName) { console.error("usage: node media.mjs --account NAME [--download] [--out dir] (<url|code> | --from file)"); process.exit(1); }

// 対象コード収集
let codes = [];
if (fromFile) {
  const txt = readFileSync(fromFile, "utf8");
  codes = [...txt.matchAll(/\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/g)].map(m => m[1]);
  codes = [...new Set(codes)];
} else if (positional.length) {
  codes = positional.map(parseCode);
}
if (!codes.length) { console.error("[!] 対象が無い。<url|code> か --from file を指定"); process.exit(1); }

if (download && !existsSync(outDir)) mkdirSync(outDir, { recursive: true });

async function resolveMedia(code) {
  const id = codeToId(code);
  const { json } = await igFetch(accountName, `/api/v1/media/${id}/info/`);
  const it = json?.items?.[0];
  if (!it) return { code, error: "not found" };
  const user = it.user?.username;
  // carousel 対応: 子メディアを展開
  const nodes = it.carousel_media || [it];
  const assets = nodes.map((n, idx) => {
    if (n.video_versions?.length) { const v = n.video_versions[0]; return { kind: "video", w: v.width, h: v.height, url: v.url, idx }; }
    const img = n.image_versions2?.candidates?.[0]; return { kind: "image", w: img?.width, h: img?.height, url: img?.url, idx };
  });
  return { code, user, type: it.media_type, duration: it.video_duration, views: it.play_count || it.ig_play_count, likes: it.like_count, assets };
}

async function dl(url, dest) {
  const r = await fetch(url);
  if (!r.ok) throw new Error("HTTP " + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  writeFileSync(dest, buf);
  return buf.length;
}

const fmt = (n) => (n ?? 0).toLocaleString("en-US");
let done = 0, totalBytes = 0;
for (const code of codes) {
  const m = await resolveMedia(code).catch(e => ({ code, error: e.message }));
  if (m.error) { console.log(`✗ ${code}: ${m.error}`); continue; }
  console.log(`\n@${m.user}  /${code}/  ${m.type === 2 ? "🎬video" : "🖼"} ❤${fmt(m.likes)}${m.views ? ` ▶${fmt(m.views)}` : ""}${m.duration ? ` ${m.duration.toFixed(0)}s` : ""}`);
  for (const a of m.assets) {
    if (!a.url) { console.log(`   [${a.idx}] (no url)`); continue; }
    const ext = a.kind === "video" ? "mp4" : "jpg";
    const name = `${m.user}_${code}${m.assets.length > 1 ? "_" + a.idx : ""}.${ext}`;
    if (download) {
      try { const bytes = await dl(a.url, join(outDir, name)); totalBytes += bytes; done++;
        console.log(`   ✓ ${name}  ${a.w}x${a.h}  ${(bytes / 1024 / 1024).toFixed(2)} MB`); }
      catch (e) { console.log(`   ✗ ${name}: ${e.message}`); }
    } else {
      console.log(`   [${a.kind} ${a.w}x${a.h}] ${a.url}`);
    }
  }
  await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
}
if (download) console.log(`\n=== ${done} files, ${(totalBytes / 1024 / 1024).toFixed(1)} MB → ${outDir} ===`);
