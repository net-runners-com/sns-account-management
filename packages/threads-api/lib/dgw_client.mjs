// Threads DGW (Distributed Gateway) WebSocket client
//
// gateway.threads.com/ws/lightspeed に接続して real-time push (like/follow/reply 等) を受信.
//
// プロトコル:
//   - WebSocket binary frame
//   - DGW frame layer: PING/PONG/OPEN/DATA/ACK/CLOSE
//   - Stream 0 (FALCO/main) で activity sync
//   - 初期 OPEN(stream=0) → DATA(JSON envelope { app_id, device_id, payload, request_id, type })
//   - サーバ push: DATA(JSON {request_id, payload:<base64-protobuf>})
//
// 参考: mautrix/meta pkg/messagix/dgw/{dgwsocket,frames}.go
import WebSocket from "ws";
import { randomUUID } from "crypto";
import { getAccount } from "../session.mjs";

const FRAME = {
  DRAIN: 0x03,
  PING: 0x09,
  PONG: 0x0a,
  ACK: 0x0c,
  DATA: 0x0d,
  CLOSE: 0x0e,
  OPEN: 0x0f,
};
const FRAME_NAMES = Object.fromEntries(Object.entries(FRAME).map(([k, v]) => [v, k]));

function le16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n, 0); return b; }
function le16r(buf, off) { return buf.readUInt16LE(off); }

// ---- Frame builders ----

function buildPing() { return Buffer.from([FRAME.PING]); }
function buildPong() { return Buffer.from([FRAME.PONG]); }

function buildOpen(streamId, params = {}) {
  const payload = Buffer.from(JSON.stringify(params), "utf8");
  return Buffer.concat([
    Buffer.from([FRAME.OPEN]),
    le16(streamId),
    le16(payload.length),
    Buffer.from([0x00]),  // unknown
    payload,
  ]);
}

function buildData(streamId, payload, { requiresAck = false, ackId = 0 } = {}) {
  const ackField = (ackId & 0x7fff) | (requiresAck ? 0x8000 : 0);
  return Buffer.concat([
    Buffer.from([FRAME.DATA]),
    le16(streamId),
    le16(payload.length + 2),
    Buffer.from([0x00]),  // unknown
    le16(ackField),
    payload,
  ]);
}

function buildAck(streamId, ackId) {
  return Buffer.concat([
    Buffer.from([FRAME.ACK]),
    le16(streamId),
    le16(2),
    Buffer.from([0x00]),
    le16(ackId),
  ]);
}

// ---- Frame parsers ----

function parseFrames(buf) {
  const out = [];
  let off = 0;
  while (off < buf.length) {
    const ft = buf[off];
    if (ft === FRAME.PING || ft === FRAME.PONG) {
      out.push({ type: FRAME_NAMES[ft] });
      off += 1;
    } else if (ft === FRAME.OPEN) {
      if (buf.length < off + 6) break;
      const streamId = le16r(buf, off + 1);
      const plen = le16r(buf, off + 3);
      // off+5 is unknown byte, payload starts at off+6
      const payload = buf.slice(off + 6, off + 6 + plen);
      let params = null;
      try { params = JSON.parse(payload.toString("utf8")); } catch {}
      out.push({ type: "OPEN", streamId, params, raw: payload });
      off += 6 + plen;
    } else if (ft === FRAME.DATA) {
      if (buf.length < off + 8) break;
      const streamId = le16r(buf, off + 1);
      const length = le16r(buf, off + 3);
      const ackField = le16r(buf, off + 6);
      const requiresAck = (ackField & 0x8000) > 0;
      const ackId = ackField & 0x7fff;
      const payload = buf.slice(off + 8, off + 8 + (length - 2));
      out.push({ type: "DATA", streamId, requiresAck, ackId, payload });
      off += 8 + (length - 2);
    } else if (ft === FRAME.ACK) {
      if (buf.length < off + 8) break;
      const streamId = le16r(buf, off + 1);
      const ackId = le16r(buf, off + 6);
      out.push({ type: "ACK", streamId, ackId });
      off += 8;
    } else if (ft === FRAME.CLOSE) {
      out.push({ type: "CLOSE", raw: buf.slice(off) });
      break;
    } else {
      out.push({ type: "UNKNOWN", ft, raw: buf.slice(off) });
      break;
    }
  }
  return out;
}

// ---- DGW Client ----

export class DGWClient {
  constructor({ accountName, appId = "238260118697367", deviceId, seqId, onEvent, onLog } = {}) {
    if (!accountName) throw new Error("accountName required");
    this.accountName = accountName;
    this.appId = appId;
    this.deviceId = deviceId || randomUUID();
    this.seqId = seqId;  // 既知の seq_id (なければ default 116 を使う)
    this.onEvent = onEvent || (() => {});
    this.onLog = onLog || ((...a) => console.log("[dgw]", ...a));
    this.ws = null;
    this.requestId = 0;
    this.pingTimer = null;
    this.connected = false;
  }

  buildUrl() {
    const userId = getAccount(this.accountName).ds_user_id || "0";
    const u = new URL("wss://gateway.threads.com/ws/lightspeed");
    u.searchParams.set("x-dgw-appid", this.appId);
    u.searchParams.set("x-dgw-appversion", "0");
    u.searchParams.set("x-dgw-authtype", "6:0");
    u.searchParams.set("x-dgw-version", "5");
    u.searchParams.set("x-dgw-uuid", userId);
    u.searchParams.set("x-dgw-tier", "prod");
    u.searchParams.set("x-dgw-deviceid", this.deviceId);
    return u.toString();
  }

  async connect() {
    const acc = getAccount(this.accountName);
    if (!acc.cookies) throw new Error(`no cookies for ${this.accountName}`);
    const url = this.buildUrl();
    this.onLog("connecting", url.slice(0, 100));
    this.ws = new WebSocket(url, {
      headers: {
        Cookie: acc.cookies,
        Origin: "https://www.threads.com",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
      },
      perMessageDeflate: false,
    });

    this.ws.on("open", () => this._onOpen());
    this.ws.on("message", (data, isBinary) => this._onMessage(data, isBinary));
    this.ws.on("close", (code, reason) => this.onLog("closed", code, String(reason)));
    this.ws.on("error", (e) => this.onLog("error", e.message));
  }

  _onOpen() {
    this.onLog("WebSocket open");
    // SEND OPEN(stream=0, {}) + DATA(stream=0, sync envelope)
    const open = buildOpen(0, {});
    const reqId = ++this.requestId;
    const innerPayload = JSON.stringify({
      database: 231,
      epoch_id: 0,
      failure_count: 0,
      last_applied_cursor: JSON.stringify({ seq_id: this.seqId ?? 116 }),
      sync_params: JSON.stringify({
        user_agent: "WMI Web",
        snapshot_at_ms: Date.now(),
        prevalidated_graphql_doc_id: "26454507537562938",
        graphql_variables: JSON.stringify({
          __relay_internal__pv__BarcelonaIsMicgUserMigrationEnabledrelayprovider: false,
        }),
      }),
      version: -3,
    });
    const env = Buffer.from(JSON.stringify({
      app_id: this.appId,
      device_id: this.deviceId,
      payload: innerPayload,
      request_id: reqId,
      type: 2,
    }), "utf8");
    const data = buildData(0, env, { requiresAck: true, ackId: 0 });
    this.ws.send(Buffer.concat([open, data]));
    this.onLog(`SEND OPEN+DATA stream=0 (req_id=${reqId}, ${data.length}B data)`);

    // PING every 15s
    this.pingTimer = setInterval(() => {
      try { this.ws.send(buildPing()); } catch {}
    }, 15000);
  }

  _onMessage(data, isBinary) {
    if (!isBinary) {
      this.onLog("got TEXT message:", data.toString().slice(0, 200));
      return;
    }
    const buf = Buffer.from(data);
    const frames = parseFrames(buf);
    for (const f of frames) {
      this._handleFrame(f);
    }
  }

  _handleFrame(f) {
    switch (f.type) {
      case "PONG":
        this.onLog("PONG");
        break;
      case "PING":
        this.onLog("PING received → sending PONG");
        try { this.ws.send(buildPong()); } catch {}
        break;
      case "OPEN":
        this.onLog(`OPEN-RESP stream=${f.streamId} params=${JSON.stringify(f.params)}`);
        if (f.params?.code === 200) this.connected = true;
        break;
      case "DATA": {
        // payload is JSON {"request_id":N, "payload":"<base64>"}
        let outer = null;
        try { outer = JSON.parse(f.payload.toString("utf8")); } catch {}
        let inner = null;
        if (outer?.payload) {
          try { inner = Buffer.from(outer.payload, "base64"); } catch {}
        }
        this.onLog(`DATA stream=${f.streamId} ack=${f.requiresAck} ack_id=${f.ackId} req_id=${outer?.request_id} inner_size=${inner?.length}`);
        if (f.requiresAck) {
          try { this.ws.send(buildAck(f.streamId, f.ackId)); } catch {}
        }
        // Pass to event handler
        this.onEvent({
          requestId: outer?.request_id,
          rawJSON: outer,
          inner,
          innerHex: inner?.toString("hex"),
        });
        break;
      }
      case "ACK":
        this.onLog(`ACK stream=${f.streamId} ack_id=${f.ackId}`);
        break;
      default:
        this.onLog(`other frame: ${f.type}`);
    }
  }

  close() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.ws) try { this.ws.close(); } catch {}
  }
}
