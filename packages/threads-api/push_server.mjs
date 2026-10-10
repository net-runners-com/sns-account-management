// Threads push 受信 HTTP API サーバ (常駐 daemon, AVD 不要 polling 版)
//
// アーキテクチャ:
//   このサーバ → 5-10秒 polling (badge query → 変化検知 → activity feed) → イベント
//                ↓
//          /tmp/threads_push_events.jsonl (永続化, 直近 N 件)
//
// API:
//   GET  /health                       — status check
//   GET  /events                       — 最新 100 件 (JSON array)
//   GET  /events?type=like|follow|dm   — type filter
//   GET  /events?since=<unix_ms>       — 指定時刻以降のみ
//   GET  /events?limit=N               — 件数指定
//   GET  /stream                       — SSE リアルタイム配信
//   POST /clear                        — メモリ + ファイル全消去
//
// 起動:
//   node libs/threads-api/push_server.mjs --account <name>
//   node libs/threads-api/push_server.mjs --account <name> --port 7878 --interval 5000
//
// account は --account or env THREADS_ACCOUNT 必須.
//
// クライアント例:
//   curl http://localhost:7878/events?type=like
//   curl -N http://localhost:7878/stream
import { createServer } from "http";
import { writeFileSync, appendFileSync, readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { BadgePollingBridge } from "./lib/badge_polling.mjs";
import { DGWDMListener } from "./lib/dgw_dm_listener.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STORE_FILE = "/tmp/threads_push_events.jsonl";
const MAX_EVENTS = 5000;

const args = process.argv.slice(2);
let port = 7878;
let accountName = process.env.THREADS_ACCOUNT || null;
let intervalMs = 5000;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--port") port = Number(args[++i]);
  else if (args[i] === "--account") accountName = args[++i];
  else if (args[i] === "--interval") intervalMs = Number(args[++i]);
}
if (!accountName) {
  console.error("ERROR: --account <name> または env THREADS_ACCOUNT が必要");
  console.error("usage: node push_server.mjs --account NAME [--port 7878] [--interval 5000]");
  process.exit(1);
}

// ── In-memory ring buffer + persistence ──
const events = [];
const sseClients = new Set();

// Restore on startup
if (existsSync(STORE_FILE)) {
  try {
    const lines = readFileSync(STORE_FILE, "utf8").split("\n").filter(Boolean);
    for (const line of lines) {
      try { events.push(JSON.parse(line)); } catch {}
    }
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
    console.log(`[server] restored ${events.length} events from disk`);
  } catch {}
}

function persistEvent(ev) {
  try { appendFileSync(STORE_FILE, JSON.stringify(ev) + "\n"); } catch {}
}

function rotateStore() {
  try {
    const recent = events.slice(-MAX_EVENTS);
    writeFileSync(STORE_FILE, recent.map((e) => JSON.stringify(e)).join("\n") + "\n");
  } catch {}
}

// ── Polling bridge (AVD 不要) ──
const bridge = new BadgePollingBridge({ accountName, intervalMs });
bridge.on("info", (m) => console.log(`[poll] ${m}`));
bridge.on("error", (e) => console.error(`[poll] error: ${e.message}`));
bridge.on("tick", ({ badge, changed }) => {
  if (changed) console.log(`[poll] badge changed → fetching activity feed`);
});

bridge.on("event", (it) => {
  const ev = {
    received_at: Date.now(),
    ...it,
  };
  events.push(ev);
  if (events.length > MAX_EVENTS * 1.2) {
    events.splice(0, events.length - MAX_EVENTS);
    rotateStore();
  } else {
    persistEvent(ev);
  }
  const line = `data: ${JSON.stringify(ev)}\n\n`;
  for (const res of sseClients) {
    try { res.write(line); } catch {}
  }
  console.log(`[event] ${ev.type} from=@${ev.from_username} (${ev.from_user_id})`);
});

await bridge.start();

// ── DGW DM リアルタイムリスナー (parallel, AVD 不要) ──
const dmListener = new DGWDMListener({ accountName });
dmListener.on("ready", () => console.log("[dgw-dm] ✅ ready (gateway.threads.com)"));
dmListener.on("dm", (m) => {
  const ev = {
    received_at: Date.now(),
    type: "dm",
    from_username: m.from_username,
    from_user_id: m.from_user_igid,
    from_name: m.from_name,
    timestamp: m.timestamp,
    thread_id: m.thread_fbid,
    content_preview: m.text || "(non-text)",
    message_id: m.message_id,
    target_post_pk: null,
    target_post_code: null,
  };
  events.push(ev);
  if (events.length > MAX_EVENTS * 1.2) {
    events.splice(0, events.length - MAX_EVENTS);
    rotateStore();
  } else {
    persistEvent(ev);
  }
  const line = `data: ${JSON.stringify(ev)}\n\n`;
  for (const res of sseClients) { try { res.write(line); } catch {} }
  console.log(`[event] dm from=@${m.from_username} "${(m.text || "").slice(0, 40)}"`);
});
dmListener.start().catch((e) => console.error("[dgw-dm] start failed:", e.message));

// ── HTTP server ──
const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  const send = (status, obj, headers = {}) => {
    res.writeHead(status, { "Content-Type": "application/json", ...headers });
    res.end(typeof obj === "string" ? obj : JSON.stringify(obj));
  };

  if (url.pathname === "/health") {
    return send(200, {
      status: "ok",
      account: accountName,
      poll_interval_ms: intervalMs,
      events_total: events.length,
      sse_clients: sseClients.size,
      uptime_s: Math.floor(process.uptime()),
      last_badge: bridge.lastBadge,
    });
  }

  if (url.pathname === "/events" && req.method === "GET") {
    const type = url.searchParams.get("type");
    const since = Number(url.searchParams.get("since")) || 0;
    const limit = Math.min(Number(url.searchParams.get("limit")) || 100, 1000);
    let filtered = events;
    if (type) filtered = filtered.filter((e) => e.type === type);
    if (since) filtered = filtered.filter((e) => (e.received_at || 0) >= since);
    return send(200, filtered.slice(-limit));
  }

  if (url.pathname === "/stream") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(": connected\n\n");
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
    return;
  }

  if (url.pathname === "/clear" && req.method === "POST") {
    events.length = 0;
    try { writeFileSync(STORE_FILE, ""); } catch {}
    return send(200, { ok: true });
  }

  send(404, { error: "not found", endpoints: ["/health", "/events", "/stream", "/clear"] });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`[server] listening on http://127.0.0.1:${port}`);
  console.log(`[server] try: curl http://127.0.0.1:${port}/health`);
  console.log(`[server] try: curl http://127.0.0.1:${port}/events?type=like`);
  console.log(`[server] try: curl -N http://127.0.0.1:${port}/stream`);
});

process.on("SIGINT", () => {
  console.log("\n[server] shutting down...");
  bridge.stop();
  server.close();
  process.exit(0);
});
