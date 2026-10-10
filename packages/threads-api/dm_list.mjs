// Threads native DM 一覧 CLI (AVD 起動不要).
//
// 過去に AVD-Frida bridge / Frida capture が残した on-disk データから
// thread + 最新メッセージを集約して一覧化. 実行時に AVD は不要 (file 読み取りのみ).
//
//   node libs/threads-api/dm_list.mjs                    # 1 行サマリ (screenshot 風)
//   node libs/threads-api/dm_list.mjs --raw              # JSON 出力
//   node libs/threads-api/dm_list.mjs --since 2026-04-26 # 指定日以降のみ
//   node libs/threads-api/dm_list.mjs --enrich --account myaccount
//        ↑ 各 thread の最新 message_id を mobile GraphQL で本文化 (Threads native)
//
// ソース (両方読む / merge):
//   1. /tmp/threads_push_events.jsonl       — realtime_avd.mjs / push_server.mjs の push log
//   2. /tmp/threads_dm_vars*.log            — Frida v7/v8 hook の variables capture
//      (BcnInboxMultiMessagesQuery の message_ids list を抽出 → 本文 fetch で thread 解決)
//   --log / --vars-log で path 上書き可
import { readFileSync, existsSync, readdirSync } from "fs";
import { readMessages, summarizeSlideMessage } from "./lib/dm_inbox_native.mjs";

const args = process.argv.slice(2);
let pushLogPath = "/tmp/threads_push_events.jsonl";
let varsLogPaths = [];
let raw = false, enrich = false;
let account = process.env.THREADS_ACCOUNT || null;
let sinceMs = 0;

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--log") { pushLogPath = args[++i]; continue; }
  if (a === "--vars-log") { varsLogPaths.push(args[++i]); continue; }
  if (a === "--raw") { raw = true; continue; }
  if (a === "--enrich") { enrich = true; continue; }
  if (a === "--account") { account = args[++i]; continue; }
  if (a === "--since") {
    const v = args[++i];
    sinceMs = /^\d+$/.test(v) ? Number(v) : Date.parse(v);
    if (!Number.isFinite(sinceMs)) { console.error("invalid --since:", v); process.exit(1); }
    continue;
  }
}

// vars-log がデフォ未指定なら 2 箇所から拾う:
//   /tmp/threads_dm_vars*.log と <repo>/tmp/threads_dm_vars*.log
if (varsLogPaths.length === 0) {
  for (const dir of ["/tmp", "tmp"]) {
    try {
      const entries = readdirSync(dir)
        .filter((n) => /^threads_dm_vars\d*\.log$/.test(n))
        .map((n) => `${dir}/${n}`);
      varsLogPaths.push(...entries);
    } catch {}
  }
}

// === source 1: push events log (thread_id + message_id 完備) ===
const events = [];
if (existsSync(pushLogPath)) {
  const lines = readFileSync(pushLogPath, "utf8").trim().split("\n").filter(Boolean);
  for (const l of lines) {
    try {
      const j = JSON.parse(l);
      if (j.type !== "dm") continue;
      const ts = j.received_at || (j.timestamp ? Date.parse(j.timestamp) : 0);
      if (sinceMs && ts < sinceMs) continue;
      events.push({
        _src: "push",
        _ts: ts,
        thread_id: j.thread_id,
        message_id: j.message_id,
        from_username: j.from_username,
        from_user_id: j.from_user_id,
        content_preview: j.content_preview,
      });
    } catch {}
  }
}

// === source 2: Frida vars capture log (BcnInboxMultiMessagesQuery の message_ids[] を拾う) ===
const varsMessageIds = new Set();
for (const p of varsLogPaths) {
  if (!existsSync(p)) continue;
  const txt = readFileSync(p, "utf8");
  const lines = txt.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!/^\[Q\] BcnInboxMultiMessagesQuery/.test(lines[i])) continue;
    // 直後数行内の list@... の中身に message_ids がある
    for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
      const m = lines[j].match(/list@\d+ \(n=\d+\) \[ (.+) \]/);
      if (!m) continue;
      const ids = m[1].match(/"(mid\.\$[^"]+)"/g) || [];
      for (const idQuoted of ids) varsMessageIds.add(idQuoted.replace(/"/g, ""));
      break;
    }
  }
}

// === source 2 enrich: 知らない message_id があれば dm_read で本文 + thread 解決 ===
const pushMsgIds = new Set(events.map((e) => e.message_id).filter(Boolean));
const newMids = [...varsMessageIds].filter((id) => !pushMsgIds.has(id));
if (newMids.length > 0) {
  if (account) {
    try {
      const username = process.env.THREADS_USERNAME;
      const password = process.env.THREADS_PASSWORD;
      const nodes = await readMessages({
        accountName: account, username, password,
        messageIds: newMids,
      });
      for (const n of nodes) {
        const ts = Number(n.timestamp_ms || 0);
        if (sinceMs && ts < sinceMs) continue;
        events.push({
          _src: "vars",
          _ts: ts,
          thread_id: n.thread_fbid,
          message_id: n.message_id,
          from_username: n.sender?.username || null,
          from_user_id: n.sender_fbid,
          content_preview: (n.content?.xma_text || n.content?.text || `[${n.content_type}]`).slice(0, 60),
        });
      }
    } catch (e) {
      console.error(`[warn] vars-log enrich failed: ${e.message.slice(0, 100)}`);
    }
  } else {
    console.error(`[info] vars-log に ${newMids.length} 件の未確認 message_ids あり.`);
    console.error(`       --account を渡せば本文 fetch で thread 解決します.`);
  }
}

// === 集約 ===
if (events.length === 0) {
  console.error(`(no DM events in ${pushLogPath} / ${varsLogPaths.join(",")})`);
  console.error("AVD-Frida bridge で push を捕獲済みなら log path を --log で指定.");
  process.exit(0);
}

const byThread = new Map();
for (const e of events.sort((a, b) => a._ts - b._ts)) {
  if (e.thread_id) byThread.set(e.thread_id, e);
}
const threads = [...byThread.values()].sort((a, b) => b._ts - a._ts);

if (threads.length === 0) {
  console.log(`(no DM events since ${sinceMs ? new Date(sinceMs).toISOString() : "beginning"})`);
  process.exit(0);
}

if (raw) {
  console.log(JSON.stringify(threads, null, 2));
  process.exit(0);
}

const sources = [
  events.some(e=>e._src==="push") ? "push" : null,
  events.some(e=>e._src==="vars") ? "vars" : null,
].filter(Boolean).join("+");
console.log(`# Threads native DM 一覧 (${threads.length} threads, source: ${sources})\n`);

function ageStr(ts) {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec/60)}m`;
  if (sec < 86400) return `${Math.floor(sec/3600)}h`;
  return `${Math.floor(sec/86400)}d`;
}

for (const t of threads) {
  const age = ageStr(t._ts);
  const u = (t.from_username || "?").padEnd(28);
  const preview = (t.content_preview || "").replace(/\n/g, " ").slice(0, 60);
  console.log(`  ${age.padStart(4)}  ${u} ${preview}`);
  if (raw) console.log(`        thread=${t.thread_id} msg=${t.message_id}`);
}

if (enrich) {
  if (!account) {
    console.error("\n--enrich requires --account");
    process.exit(1);
  }
  console.log("\n# enrich: 各 thread の最新メッセージ本文 (mobile GraphQL)\n");
  const username = process.env.THREADS_USERNAME;
  const password = process.env.THREADS_PASSWORD;
  for (const t of threads) {
    if (!t.message_id) continue;
    try {
      const nodes = await readMessages({
        accountName: account, username, password,
        messageIds: [t.message_id],
      });
      if (nodes[0]) {
        const s = summarizeSlideMessage(nodes[0]);
        console.log(`@${t.from_username}: ${s.text || s.content_type}`);
        if (s.shared_link) console.log(`  → ${s.shared_link}`);
      } else {
        console.log(`@${t.from_username}: (message not found ${t.message_id})`);
      }
    } catch (e) {
      console.log(`@${t.from_username}: (enrich error: ${e.message.slice(0,80)})`);
    }
  }
}
