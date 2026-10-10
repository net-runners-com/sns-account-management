// gateway.threads.com/ws/lightspeed で DM リアルタイム push 受信
//
// DGW DATA frame の inner protobuf に embedded JSON が入る:
//   {"data":{"slide_delta_processor":[{"__typename":"SlideUQPPNewMessage","message":{...}}]}}
//
// AVD 不要、Node 単独で動作。lightspeed handshake は dgw_client.mjs と同じ.
import { DGWClient } from "./dgw_client.mjs";
import { EventEmitter } from "events";

export class DGWDMListener extends EventEmitter {
  constructor({ accountName } = {}) {
    super();
    this.accountName = accountName;
    this.client = null;
    this.connected = false;
  }

  _extractMessages(inner) {
    if (!inner) return [];
    try {
      // protobuf 内に JSON 文字列が embed されてる. {"data" の位置探す.
      const ascii = inner.toString("utf8");
      const idx = ascii.indexOf('{"data"');
      if (idx < 0) return [];
      // バランスした brace の終端探す
      let depth = 0, end = idx;
      for (let i = idx; i < ascii.length; i++) {
        if (ascii[i] === "{") depth++;
        else if (ascii[i] === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
      }
      const json = JSON.parse(ascii.slice(idx, end));
      const arr = json?.data?.slide_delta_processor || [];
      return arr;
    } catch (e) { return []; }
  }

  async start() {
    this.client = new DGWClient({
      accountName: this.accountName,
      seqId: 116,  // RESNAPSHOT 回避用 default
      onLog: () => {},  // mute internal log
      onEvent: (ev) => {
        const items = this._extractMessages(ev.inner);
        for (const it of items) {
          if (it.__typename === "SlideUQPPNewMessage") {
            const m = it.message;
            this.emit("dm", {
              type: "dm",
              message_id: m.message_id,
              thread_fbid: m.thread_fbid,
              text: m.content?.text_body || null,
              content_type: m.content?.__typename,
              from_username: m.sender?.username,
              from_name: m.sender?.name,
              from_user_igid: m.sender?.igid,
              from_slide_id: m.sender?.id,
              profile_pic_url: m.sender?.profile_pic_uri,
              timestamp: m.timestamp_ms ? new Date(Number(m.timestamp_ms)).toISOString() : null,
              uq_seq_id: it.uq_seq_id,
              is_forwarded: m.is_forwarded,
              has_attachments: !!m.attachments?.length,
              raw: m,
            });
          } else if (it.__typename) {
            this.emit("other", {
              type: "slide_event",
              subtype: it.__typename,
              uq_seq_id: it.uq_seq_id,
              raw: it,
            });
          }
        }
      },
    });
    await this.client.connect();
    this.connected = true;
    this.emit("ready");
  }

  stop() {
    if (this.client) this.client.close();
    this.connected = false;
  }
}
