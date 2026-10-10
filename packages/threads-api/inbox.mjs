// DM 受信箱 / スレッドメッセージ取得 CLI
//
//   node inbox.mjs --account <name>                    # 全 thread (要約)
//   node inbox.mjs --account <name> --with <username>  # 相手指定で thread 検索 + メッセージ表示
//   node inbox.mjs --account <name> --thread <id>      # thread_id 直接指定
//   node inbox.mjs --account <name> --raw              # 生 JSON
//
// account は --account or env THREADS_ACCOUNT 必須.
// .env: THREADS_USERNAME / THREADS_PASSWORD (初回 login 時のみ)
import { listThreads, getMessages, findThreadWith, summarizeThread, summarizeMessage } from "./lib/dm_inbox.mjs";

const args = process.argv.slice(2);
let account = process.env.THREADS_ACCOUNT || null;
let withUsername = null;
let threadId = null;
let amount = 50;
let raw = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--account") { account = args[++i]; continue; }
  if (a === "--with") { withUsername = args[++i]; continue; }
  if (a === "--thread") { threadId = args[++i]; continue; }
  if (a === "--limit") { amount = parseInt(args[++i], 10); continue; }
  if (a === "--raw") { raw = true; continue; }
}

if (!account) {
  console.error("ERROR: --account <name> または env THREADS_ACCOUNT が必要");
  process.exit(1);
}

try {
  if (threadId) {
    // 指定 thread のメッセージ
    const msgs = await getMessages(threadId, { account, amount });
    if (raw) console.log(JSON.stringify(msgs, null, 2));
    else {
      console.log(`[thread ${threadId}] ${msgs.length} messages:`);
      msgs.slice().reverse().forEach((m, i) => {
        const s = summarizeMessage(m);
        console.log(`  ${(i+1).toString().padStart(3)}  ${s.when?.slice(11, 19) || "?"}  user=${s.from}  ${s.is_sent_by_viewer ? "→" : "←"}  ${(s.text || "[" + s.type + "]" || "").slice(0, 80)}`);
      });
    }
  } else if (withUsername) {
    // 相手で検索 → メッセージ取得
    const t = await findThreadWith({ username: withUsername, account });
    if (!t) {
      console.error(`thread with @${withUsername} not found in inbox`);
      process.exit(1);
    }
    console.log(`[found thread] id=${t.id}  users=${(t.users || []).map(u => "@" + u.username).join(", ")}`);
    const msgs = await getMessages(t.id, { account, amount });
    if (raw) console.log(JSON.stringify({ thread: t, messages: msgs }, null, 2));
    else {
      console.log(`[messages] (newest first)`);
      msgs.forEach((m, i) => {
        const s = summarizeMessage(m);
        const arrow = s.is_sent_by_viewer ? "→" : "←";
        console.log(`  ${s.when?.slice(0, 19) || "?"}  user=${s.from}  ${arrow}  ${(s.text || "[" + s.type + "]" || "").slice(0, 100)}`);
      });
    }
  } else {
    // 全 thread 一覧
    const threads = await listThreads({ account, amount });
    if (raw) console.log(JSON.stringify(threads, null, 2));
    else {
      console.log(`[inbox] ${threads.length} threads`);
      threads.forEach((t, i) => {
        const s = summarizeThread(t);
        console.log(`  ${(i+1).toString().padStart(3)}  id=${s.thread_id}  with=[${s.users.join(", ")}]  last="${s.last_text}"`);
      });
    }
  }
} catch (e) {
  console.error("ERROR:", e.message);
  process.exit(1);
}
