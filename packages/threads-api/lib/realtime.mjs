// Threads / IG リアルタイム push 受信 (DGW WebSocket)
//
// mautrix/meta の messagix/dgw を参考に Node で実装:
//   wss://gateway.instagram.com/ws/realtime?<query>
//
// 受信できるイベント (推定):
//   - DM 受信 (typing / message_added / read_receipt)
//   - notifications (like / comment / follow)
//   - presence (online/offline)
import WebSocket from "ws";
import { randomUUID } from "crypto";
import { getAccount } from "../session.mjs";

const REALTIME_URL = "wss://gateway.instagram.com/ws/realtime";

// DGW URL の query params (mautrix/meta dgwsocket.go から)
function buildDgwUrl({ appId, deviceId } = {}) {
  const u = new URL(REALTIME_URL);
  u.searchParams.set("x-dgw-appid", appId || "936619743392459");  // IG web (一旦 IG で接続して挙動見る)
  u.searchParams.set("x-dgw-appversion", "0");
  u.searchParams.set("x-dgw-authtype", "6:0");
  u.searchParams.set("x-dgw-version", "5");
  u.searchParams.set("x-dgw-uuid", "0");
  u.searchParams.set("x-dgw-tier", "prod");
  u.searchParams.set("x-dgw-deviceid", deviceId || randomUUID());
  u.searchParams.set("x-dgw-app-stream-group", "group1");
  return u.toString();
}

/**
 * リアルタイム push 受信を開始
 * @param {object} opts
 * @param {string} opts.accountName  使う web session
 * @param {function} opts.onMessage  (msg) => void  受信フレームコールバック
 * @param {function} [opts.onOpen]   open 時のコールバック
 * @param {function} [opts.onClose]  close 時のコールバック
 * @param {string}   [opts.appId]    Override DGW app id (default IG Web)
 * @returns {WebSocket} 接続 (ws.close() で終了)
 */
export function connectRealtime({ accountName, onMessage, onOpen, onClose, appId } = {}) {
  if (!accountName) throw new Error("accountName required");
  if (!onMessage) throw new Error("onMessage callback required");
  const acc = getAccount(accountName);
  if (!acc.cookies) throw new Error(`no cookies for ${accountName}`);

  const url = buildDgwUrl({ appId });
  const ws = new WebSocket(url, {
    headers: {
      Cookie: acc.cookies,
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
      Origin: "https://www.instagram.com",
    },
    perMessageDeflate: false,
  });

  ws.on("open", () => {
    console.log(`[realtime] connected ${url.slice(0, 80)}...`);
    if (onOpen) onOpen(ws);
  });

  ws.on("message", (data, isBinary) => {
    onMessage({
      data,
      isBinary,
      hex: Buffer.isBuffer(data) ? data.subarray(0, 200).toString("hex") : null,
      ascii: Buffer.isBuffer(data) ? data.subarray(0, 200).toString("utf8").replace(/[\x00-\x1f\x7f-\xff]/g, ".") : null,
      length: data.length,
    });
  });

  ws.on("close", (code, reason) => {
    console.log(`[realtime] closed code=${code} reason="${reason}"`);
    if (onClose) onClose(code, reason);
  });

  ws.on("error", (e) => console.error(`[realtime] error:`, e.message));

  return ws;
}
