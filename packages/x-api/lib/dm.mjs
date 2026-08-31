// DM 送信 (X Web 内部 REST: POST /i/api/1.1/dm/new2.json)
// ⚠ payload / query は 2026-08 時点の Web クライアント観測に基づく想定. 実ブラウザからの
//    送信を webtrace でキャプチャして差分があれば DM_QUERY / body を合わせる (docs/autodm.md 参照).
import { randomUUID } from "crypto";
import { authHeaders } from "../session.mjs";
import { xFetch } from "./http.mjs";
import { generateTransactionId } from "./transaction.mjs";

export const DM_PATH = "/i/api/1.1/dm/new2.json";
const DM_QUERY =
  "ext=mediaColor,altText,mediaStats,highlightedLabel,voiceInfo,birdwatchPivot,superFollowMetadata,unmentionInfo,editControl,article" +
  "&include_ext_alt_text=true&include_ext_limited_action_results=true&include_reply_count=1" +
  "&tweet_mode=extended&include_ext_views=true&include_ext_edit_control=true";

/** "<小さいID>-<大きいID>" (数値比較) */
export function conversationId(a, b) {
  const [x, y] = [String(a), String(b)].sort((p, q) => (BigInt(p) < BigInt(q) ? -1 : 1));
  return `${x}-${y}`;
}

export function buildDmRequest({ myUserId, recipientId, text, requestId = randomUUID() } = {}) {
  if (!myUserId) throw new Error("myUserId required");
  if (!recipientId) throw new Error("recipientId required");
  if (!text) throw new Error("text required");
  return {
    url: `https://x.com${DM_PATH}?${DM_QUERY}`,
    body: {
      conversation_id: conversationId(myUserId, recipientId),
      recipient_ids: false,
      request_id: requestId,
      text,
      cards_platform: "Web-12",
      include_cards: 1,
      include_quote_count: true,
      dm_users: false,
    },
  };
}

/**
 * DM を1通送る. session 切れは XSessionError、その他失敗は err.status 付き Error.
 */
export async function sendDm(acc, { recipientId, text, accountName, requestId } = {}) {
  const { url, body } = buildDmRequest({ myUserId: acc.user_id, recipientId, text, requestId });
  const tid = await generateTransactionId("POST", DM_PATH);
  const mk = (a) => ({
    method: "POST",
    headers: {
      ...authHeaders(a, { json: true, referer: "https://x.com/messages" }),
      "x-client-transaction-id": tid,
    },
    body: JSON.stringify(body),
  });
  const r = await xFetch(url, mk(acc), { accountName, rebuildHeaders: mk });
  if (!r.ok) {
    const err = new Error(`DM HTTP ${r.status}: ${(r.text || JSON.stringify(r.json) || "").slice(0, 300)}`);
    err.status = r.status;
    throw err;
  }
  return { ok: true, status: r.status, conversation_id: body.conversation_id, raw: r.json };
}
