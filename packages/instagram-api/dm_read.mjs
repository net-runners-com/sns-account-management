// Instagram DM 受信箱 読み取り CLI
//
//   node dm_read.mjs --account <name>                  # スレッド一覧
//   node dm_read.mjs --account <name> --thread <id>    # スレッド内メッセージ
//   node dm_read.mjs --account <name> --raw
//
// direct_v2/inbox エンドポイント (RE 実証済み, 200)。読み取り専用。
import { igFetch } from "./lib/http.mjs";

const args = process.argv.slice(2);
let accountName = process.env.INSTAGRAM_ACCOUNT || null, raw = false, threadId = null, limit = 20;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--account") accountName = args[++i];
  else if (args[i] === "--raw") raw = true;
  else if (args[i] === "--thread") threadId = args[++i];
  else if (args[i] === "--limit") limit = Number(args[++i]);
}
if (!accountName) { console.error("usage: node dm_read.mjs --account NAME [--thread ID] [--limit N] [--raw]"); process.exit(1); }

if (threadId) {
  const { json } = await igFetch(accountName,
    `/api/v1/direct_v2/threads/${threadId}/?limit=${limit}`);
  if (raw) { console.log(JSON.stringify(json, null, 2)); process.exit(0); }
  const t = json?.thread;
  if (!t) { console.error("[!] thread not found"); process.exit(2); }
  const users = Object.fromEntries((t.users || []).map(u => [u.pk, u.username]));
  console.log(`thread: ${(t.thread_title || Object.values(users).join(", "))}`);
  console.log("─".repeat(60));
  for (const m of (t.items || []).slice().reverse()) {
    const who = users[m.user_id] || (m.user_id == json.viewer ? "me" : m.user_id);
    const when = new Date(Number(m.timestamp) / 1000).toISOString().slice(5, 16).replace("T", " ");
    let body = m.text || `[${m.item_type}]`;
    console.log(`[${when}] @${who}: ${String(body).replace(/\n/g, " ").slice(0, 80)}`);
  }
  process.exit(0);
}

// inbox 一覧
const { json } = await igFetch(accountName,
  `/api/v1/direct_v2/inbox/?persistentBadging=true&limit=${limit}&thread_message_limit=1`);
if (raw) { console.log(JSON.stringify(json, null, 2)); process.exit(0); }
const inbox = json?.inbox;
if (!inbox) { console.error(`[!] inbox 取得失敗 (status ${json?.status})`); process.exit(2); }
console.log(`unseen: ${json?.inbox?.unseen_count ?? "?"}   pending: ${json?.pending_requests_total ?? 0}`);
console.log("─".repeat(70));
for (const t of inbox.threads || []) {
  const names = (t.users || []).map(u => "@" + u.username).join(", ") || t.thread_title;
  const last = t.items?.[0];
  const preview = last ? (last.text || `[${last.item_type}]`) : "";
  const when = last ? new Date(Number(last.timestamp) / 1000).toISOString().slice(5, 16).replace("T", " ") : "";
  const unread = t.read_state === 1 ? "🔴" : "  ";
  console.log(`${unread} ${names}`);
  console.log(`     thread_id=${t.thread_id}  [${when}] ${String(preview).replace(/\n/g, " ").slice(0, 50)}`);
}
