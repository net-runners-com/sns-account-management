// note お知らせ polling サーバ (HTTP API + SSE)
//
// note には realtime push が無いので polling. /api/v3/notices?page=1 を 30秒ごと取得 →
// 直近 max(seen_id) と比較して新規のみ emit.
//
// 起動:
//   node --env-file=.env notices_server.mjs
//   node --env-file=.env notices_server.mjs --port 7979 --interval 30
//   node --env-file=.env notices_server.mjs --account personal_dev --interval 60
//
// API:
//   GET  /health                         status
//   GET  /events                         全イベント (新しい順)
//   GET  /events?type=like|follow|...    kind フィルタ
//   GET  /events?since=<unix_ms>         以降のみ
//   GET  /events?limit=N                 件数指定
//   GET  /stream                         SSE (リアルタイム push)
//   POST /clear                          全消去
//   POST /poll-now                       即 polling トリガ
import { createServer } from "http";
import { writeFileSync, appendFileSync, readFileSync, existsSync } from "fs";
import { fetchNotices, summarize, pingAuthActive, postTrackingFp, postTrackingVisitId } from "./lib/notices.mjs";

const STORE_FILE = "/tmp/note_notices_events.jsonl";
const MAX_EVENTS = 5000;

const args = process.argv.slice(2);
let port = 7979;
let accountName = process.env.NOTE_ACCOUNT || null;
let intervalSec = 30;
let emitBaseline = false;  // --emit-baseline: 初回 polling 時の既存通知も emit (テスト用)
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--port") port = Number(args[++i]);
  else if (args[i] === "--account") accountName = args[++i];
  else if (args[i] === "--interval") intervalSec = Number(args[++i]);
  else if (args[i] === "--emit-baseline") emitBaseline = true;
}

const events = [];
const sseClients = new Set();
// note は bundled notification: 新 actor 追加で id 不変のまま noticed_at が更新される.
// 単純な ID dedup では bundle 更新を取りこぼすので、id → noticed_at の Map で sig 比較.
const seenSigs = new Map();  // id -> noticed_at (ISO string)
let firstRun = true;
let lastPolledAt = null;
let polledCount = 0;

// restore from disk
if (existsSync(STORE_FILE)) {
  try {
    const lines = readFileSync(STORE_FILE, "utf8").split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const ev = JSON.parse(line);
        events.push(ev);
        if (ev.id) seenSigs.set(ev.id, ev.when || ev.received_at);
      } catch {}
    }
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
    console.log(`[server] restored ${events.length} events from disk (${seenSigs.size} unique ids)`);
    if (events.length > 0) firstRun = false;
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
function broadcast(ev) {
  const line = `data: ${JSON.stringify(ev)}\n\n`;
  for (const res of sseClients) {
    try { res.write(line); } catch {}
  }
}

// fp は server 正規化値を cache (毎回再取得は不要)
let cachedFp = null;
let lastVisit = null;  // { visit_id, expire_at }
let lastVisitPing = null;

async function pollOnce() {
  try {
    // ★ note web frontend が「お知らせ取得」する時の完全な順序を再現:
    //   1. POST /api/v3/trackings/fp        (初回のみ)
    //   2. POST /api/v3/trackings/visit_id  (毎回 — これがないと realtime 通知配信が止まる)
    //   3. GET  /api/v3/notices?page=1
    if (!cachedFp) {
      cachedFp = await postTrackingFp({ accountName }).catch(() => null);
      if (cachedFp) console.log(`[poll] fp acquired: ${cachedFp.slice(0, 12)}...`);
    }
    if (cachedFp) {
      const v = await postTrackingVisitId({ accountName, fp: cachedFp }).catch(() => null);
      if (v) {
        lastVisit = v;
        lastVisitPing = { at: Date.now(), ok: true };
      } else {
        lastVisitPing = { at: Date.now(), ok: false };
      }
    }
    // note API は per > 20 で空応答返す仕様. 20 が実用上限.
    const r = await fetchNotices({ accountName, page: 1, per: 20 });
    const data = r.data || [];
    polledCount++;
    lastPolledAt = Date.now();

    if (firstRun) {
      firstRun = false;
      if (emitBaseline) {
        console.log(`[poll] first run: ${data.length} events を emit (--emit-baseline)`);
        // 古い順に emit
        for (const n of data.slice().reverse()) {
          seenSigs.set(n.id, n.noticed_at);
          const s = summarize(n);
          const ev = { received_at: Date.now(), ...s, raw: n };
          events.push(ev);
          persistEvent(ev);
          broadcast(ev);
        }
        console.log(`[poll] baseline emit 完了 (events_total: ${events.length})`);
        return;
      }
      // 通常 baseline: 既存全部 seen 扱い、emit せず
      for (const n of data) seenSigs.set(n.id, n.noticed_at);
      console.log(`[poll] first run baseline: ${data.length} events (skip emit)`);
      return;
    }

    let newCount = 0;
    // 新しい順 (id desc) → 出力順は id asc にしたい (古い→新しい)
    for (const n of data.slice().reverse()) {
      // bundled notification: 同じ id でも noticed_at が更新されたら新着扱い
      const prevSig = seenSigs.get(n.id);
      if (prevSig === n.noticed_at) continue;
      const isUpdate = prevSig !== undefined;
      seenSigs.set(n.id, n.noticed_at);
      const s = summarize(n);
      const ev = { received_at: Date.now(), ...s, update: isUpdate, raw: n };
      events.push(ev);
      if (events.length > MAX_EVENTS * 1.2) {
        events.splice(0, events.length - MAX_EVENTS);
        rotateStore();
      } else {
        persistEvent(ev);
      }
      broadcast(ev);
      const tag = isUpdate ? "[update]" : "[event] ";
      console.log(`${tag} ${s.kind}  ${s.actors.join(",")}  "${s.text.slice(0, 60)}"`);
      newCount++;
    }
    if (newCount > 0) console.log(`[poll] ${newCount} new events (total stored: ${events.length})`);
  } catch (e) {
    console.error(`[poll] error: ${e.message}`);
  }
}

// auth/active heartbeat (JWT refresh, 5分間隔)
let lastHeartbeat = null;
async function heartbeatAuth() {
  try {
    const r = await pingAuthActive({ accountName });
    lastHeartbeat = { at: Date.now(), ok: r.ok, status: r.status };
    if (!r.ok) console.error(`[heartbeat-auth] HTTP ${r.status} (session 切れた可能性)`);
  } catch (e) {
    console.error(`[heartbeat-auth] ${e.message}`);
  }
}

// initial poll + interval
await pollOnce();          // fp + visit_id + notices を直列に
await heartbeatAuth();
const pollTimer = setInterval(pollOnce, intervalSec * 1000);
const heartbeatTimer = setInterval(heartbeatAuth, 5 * 60 * 1000);

// HTTP server
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
      poll_interval_sec: intervalSec,
      events_total: events.length,
      seen_ids: seenSigs.size,
      sse_clients: sseClients.size,
      polled_count: polledCount,
      last_polled_at: lastPolledAt,
      last_heartbeat: lastHeartbeat,
      last_visit_ping: lastVisitPing,
      visit: lastVisit,
      fp: cachedFp ? cachedFp.slice(0, 12) + "..." : null,
      uptime_s: Math.floor(process.uptime()),
    });
  }

  if (url.pathname === "/events" && req.method === "GET") {
    const type = url.searchParams.get("type");
    const since = Number(url.searchParams.get("since")) || 0;
    const limit = Math.min(Number(url.searchParams.get("limit")) || 100, 1000);
    let filtered = events;
    if (type) filtered = filtered.filter((e) => e.kind === type);
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
    seenSigs.clear();
    firstRun = true;
    try { writeFileSync(STORE_FILE, ""); } catch {}
    return send(200, { ok: true });
  }

  if (url.pathname === "/poll-now" && req.method === "POST") {
    pollOnce().then(() => send(200, { ok: true, total: events.length }));
    return;
  }

  send(404, { error: "not found", endpoints: ["/health", "/events", "/stream", "/clear", "/poll-now"] });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`[server] listening on http://127.0.0.1:${port}`);
  console.log(`[server] account=${accountName || "(NOTE_COOKIES env)"} poll_interval=${intervalSec}s`);
  console.log(`[server] try: curl http://127.0.0.1:${port}/health`);
  console.log(`[server] try: curl -N http://127.0.0.1:${port}/stream`);
});

process.on("SIGINT", () => {
  console.log("\n[server] shutting down...");
  clearInterval(pollTimer);
  clearInterval(heartbeatTimer);
  clearInterval(visitTimer);
  server.close();
  process.exit(0);
});
