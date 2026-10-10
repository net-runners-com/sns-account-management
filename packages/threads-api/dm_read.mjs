// Threads native DM read CLI.
// 既存 inbox.mjs (instagrapi-bridge 経由 Instagram DM) とは別系統で,
// Threads-issued Bearer + mobile GraphQL endpoint で Threads native DM を直叩きする.
//
//   node --env-file=.env dm_read.mjs --account <a> --mailbox
//   node --env-file=.env dm_read.mjs --account <a> --messages mid.$abc,mid.$def
//   node --env-file=.env dm_read.mjs --account <a> --user 18043066382528144
//   node --env-file=.env dm_read.mjs --account <a> --reach 18043066382528144 --social
//
// account は --account or env THREADS_ACCOUNT 必須.
// .env: THREADS_USERNAME / THREADS_PASSWORD (初回 Bearer 取得時のみ)
//
// 制約:
//   thread 一覧 / 全 thread の message_ids 列挙は本 CLI では不可
//   (Threads native の inbox snapshot は Iris realtime push 専用).
//   message_ids は AVD-Frida bridge or push 受信から拾う想定.
import {
  getMailboxBadge,
  readMessages,
  getUsers,
  getReachability,
  summarizeSlideMessage,
} from "./lib/dm_inbox_native.mjs";

const args = process.argv.slice(2);
let account = process.env.THREADS_ACCOUNT || null;
let mode = null;        // "mailbox" | "messages" | "user" | "reach"
let messageIds = [];
let ethmuIds = [];
let raw = false;
let social = false;

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--account") { account = args[++i]; continue; }
  if (a === "--mailbox") { mode = "mailbox"; continue; }
  if (a === "--messages") { mode = "messages"; messageIds = args[++i].split(",").map((s) => s.trim()).filter(Boolean); continue; }
  if (a === "--user") { mode = "user"; ethmuIds = args[++i].split(",").map((s) => s.trim()).filter(Boolean); continue; }
  if (a === "--reach") { mode = "reach"; ethmuIds = args[++i].split(",").map((s) => s.trim()).filter(Boolean); continue; }
  if (a === "--social") { social = true; continue; }
  if (a === "--raw") { raw = true; continue; }
}

if (!account) {
  console.error("ERROR: --account <name> または env THREADS_ACCOUNT が必要");
  process.exit(1);
}
if (!mode) {
  console.error("ERROR: --mailbox / --messages / --user / --reach のいずれかが必要");
  process.exit(1);
}

const username = process.env.THREADS_USERNAME;
const password = process.env.THREADS_PASSWORD;
const opts = { accountName: account, username, password };

try {
  if (mode === "mailbox") {
    const m = await getMailboxBadge(opts);
    if (raw) console.log(JSON.stringify(m, null, 2));
    else {
      console.log(`mailbox_id: ${m.id}`);
      console.log(`primary:  ${m.inbox_badge_counts?.unseen_badge_count ?? "?"} unseen / ${m.inbox_badge_counts?.total_threads_count ?? "?"} threads`);
      console.log(`pending:  ${m.pending_badge_counts?.unseen_badge_count ?? "?"} unseen / ${m.pending_badge_counts?.total_threads_count ?? "?"} threads`);
      console.log(`spam:     ${m.spam_badge_counts?.unseen_badge_count ?? "?"} unseen / ${m.spam_badge_counts?.total_threads_count ?? "?"} threads`);
    }
  } else if (mode === "messages") {
    const nodes = await readMessages({ ...opts, messageIds });
    if (raw) console.log(JSON.stringify(nodes, null, 2));
    else {
      const sorted = nodes.slice().sort((a, b) => Number(a.timestamp_ms || 0) - Number(b.timestamp_ms || 0));
      for (const n of sorted) {
        const s = summarizeSlideMessage(n);
        console.log(`\n[${s.when}] @${s.from} (thread ${s.thread_fbid})`);
        console.log(`  ${s.text}`);
        if (s.shared_link) console.log(`  → ${s.shared_link}` + (s.shared_title ? ` "${s.shared_title}"` : ""));
        if (s.reactions.length) console.log(`  reactions: ${s.reactions.map((r) => `${r.react}(${r.user})`).join(" ")}`);
      }
      console.log(`\n(${nodes.length} messages)`);
    }
  } else if (mode === "user") {
    const us = await getUsers({ ...opts, ethmuIds });
    if (raw) console.log(JSON.stringify(us, null, 2));
    else {
      for (const u of us) {
        console.log(`\nethmu=${u.id} username=${u.username || "(null)"} verified=${u.is_verified}`);
        console.log(`  igid=${u.igid} linked_ig=${u.linked_ig_user_igid}`);
        console.log(`  reachable=${u.reachability_status} blocking=${u.blocking} restricting=${u.restricting}`);
      }
    }
  } else if (mode === "reach") {
    const us = await getReachability({ ...opts, ethmuIds, fetchSocialContext: social });
    if (raw) console.log(JSON.stringify(us, null, 2));
    else {
      for (const u of us) {
        console.log(`\nethmu=${u.id} username=${u.username || "(null)"}`);
        console.log(`  reachable=${u.reachability_status} blocking=${u.blocking} restricting=${u.restricting}`);
        if (u.threads_slide_social_context) console.log(`  social=${JSON.stringify(u.threads_slide_social_context)}`);
      }
    }
  }
} catch (e) {
  console.error("ERROR:", e.message);
  if (e.payload) console.error(JSON.stringify(e.payload, null, 2).slice(0, 800));
  process.exit(1);
}
