// DM 受信箱 / スレッドメッセージ取得 API (instagrapi-bridge 経由)
//
// 機能:
//   listThreads(opts)            - 受信箱の thread 一覧
//   getMessages(threadId, opts)  - 指定 thread のメッセージ一覧 (送信履歴含む)
//   findThreadWith({ username }) - 特定の相手とのスレッドを探す
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BRIDGE_PY = resolve(__dirname, "../instagrapi-bridge/.venv/bin/python");
const BRIDGE_SCRIPT = resolve(__dirname, "../instagrapi-bridge/bridge.py");

function callBridge(args, env = {}) {
  const r = spawnSync(BRIDGE_PY, [BRIDGE_SCRIPT, ...args], {
    env: { ...process.env, ...env },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) {
    throw new Error(`bridge exit ${r.status}\nstderr: ${(r.stderr || "").slice(0, 500)}`);
  }
  return JSON.parse(r.stdout.trim());
}

function envFor({ account, threadsMode = false } = {}) {
  const resolved = account || process.env.INSTAGRAPI_ACCOUNT || process.env.THREADS_ACCOUNT;
  if (!resolved) throw new Error("account name required (pass account opt, or set INSTAGRAPI_ACCOUNT / THREADS_ACCOUNT env)");
  return {
    INSTAGRAPI_ACCOUNT: resolved,
    INSTAGRAPI_USERNAME: process.env.THREADS_USERNAME,
    INSTAGRAPI_PASSWORD: process.env.THREADS_PASSWORD,
    ...(threadsMode ? { INSTAGRAPI_THREADS_MODE: "1" } : {}),
  };
}

export async function listThreads({ account, amount = 20, threadsMode = false } = {}) {
  return callBridge(["dm-threads", String(amount)], envFor({ account, threadsMode }));
}

export async function getMessages(threadId, { account, amount = 50, threadsMode = false } = {}) {
  if (!threadId) throw new Error("threadId required");
  return callBridge(["dm-messages", String(threadId), String(amount)], envFor({ account, threadsMode }));
}

export async function findThreadWith({ username, account, threadsMode = false } = {}) {
  if (!username) throw new Error("username required");
  const target = String(username).replace(/^@/, "").toLowerCase();
  const threads = await listThreads({ account, amount: 50, threadsMode });
  return threads.find(t =>
    (t.users || []).some(u => String(u.username || "").toLowerCase() === target)
  );
}

// 表示整形: thread を 1 行に
export function summarizeThread(t) {
  const last = (t.messages && t.messages[0]) || null;
  const lastText = (last?.text || last?.item_type || "").toString().slice(0, 60);
  return {
    thread_id: t.id,
    users: (t.users || []).map(u => u.username),
    is_group: t.is_group,
    thread_type: t.thread_type,
    thread_subtype: t.thread_subtype,
    last_activity_at: t.last_activity_at,
    last_text: lastText,
    last_user_id: last?.user_id,
  };
}

export function summarizeMessage(m) {
  // instagrapi は datetime 文字列 ("2026-04-25 23:01:34") または microseconds 数値で返す
  let ts = null;
  if (m.timestamp) {
    const v = m.timestamp;
    if (typeof v === "string" && /\d{4}-\d{2}-\d{2}/.test(v)) {
      ts = new Date(v.replace(" ", "T") + "Z");
    } else {
      const n = String(v);
      if (n.length >= 16) ts = new Date(Math.floor(Number(n) / 1000));   // μs
      else if (n.length >= 13) ts = new Date(Number(n));                  // ms
      else if (n.length >= 10) ts = new Date(Number(n) * 1000);           // s
    }
  }
  return {
    id: m.id,
    when: ts ? ts.toISOString() : null,
    from: m.user_id,
    type: m.item_type,
    text: m.text,
    is_sent_by_viewer: m.is_sent_by_viewer,
    reactions_count: (m.reactions?.emojis?.length || 0),
  };
}
