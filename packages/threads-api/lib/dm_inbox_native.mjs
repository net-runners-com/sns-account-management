// Threads native DM read API (mobile GraphQL endpoint i.instagram.com/graphql_www).
//
// 既存 dm_inbox.mjs が instagrapi-bridge 経由 (Instagram DM, 別系統) なのに対し,
// こちらは Threads-issued Bearer + mobile-captured doc_id で Threads native DM を直叩きする.
// 2026-04-27 Frida capture で確定したレシピ.
//
// 注意:
//   - スレッド一覧 (mailbox snapshot) は Iris realtime channel 経由でしか降ってこない仕様.
//     => 「全 thread を列挙」は本 lib では出来ない. message_ids / ethmu_ids を呼び出し側が用意.
//   - 取得元の message_ids は AVD-Frida bridge かまたは push 受信から確保する想定.
//   - Bearer は dms.mjs の getOrFetchBearer で取得 (初回 login 時のみ instagrapi-bridge を使う).
import { getOrFetchBearer } from "./dms.mjs";
import { BUNDLED_DOC_IDS } from "./graphql_docs.mjs";

const GRAPHQL_URL = "https://i.instagram.com/graphql_www";
const APP_ID = process.env.THREADS_APP_ID || "238260118697367";
const UA = process.env.THREADS_BARCELONA_UA
  || "Barcelona 426.0.0.36.67 Android (34/14; 420dpi; 1080x2400; Google/google; sdk_gphone64_arm64; emu64a; ranchu; en_US; 947514750)";

// 実 GraphQL 呼び出し
async function mobileCall({ accountName, username, password, friendly, root, doc_id, variables }) {
  const { bearer } = getOrFetchBearer({ accountName, username, password });
  const docId = doc_id || BUNDLED_DOC_IDS[friendly];
  if (!docId) throw new Error(`doc_id unknown for "${friendly}". Update lib/graphql_docs.mjs`);

  const body = new URLSearchParams({
    client_doc_id: docId,
    variables: JSON.stringify(variables || {}),
  }).toString();

  const r = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Authorization": bearer,
      "X-FB-Friendly-Name": friendly,
      "X-Root-Field-Name": root,
      "x-graphql-client-library": "pando",
      "X-IG-App-ID": APP_ID,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    redirect: "manual",
  });
  const raw = await r.text();
  let json; try { json = JSON.parse(raw); } catch { json = { _raw: raw.slice(0, 600) }; }
  if (json?.errors) {
    const e = json.errors[0] || {};
    const summary = `${e.code || "?"}: ${e.message || ""} (fbtrace=${e.fbtrace_id || "?"})`;
    const err = new Error(`Threads GraphQL error — ${summary}`);
    err.payload = json;
    err.http = r.status;
    throw err;
  }
  return { http: r.status, data: json?.data, json };
}

// === public helpers ===

/**
 * Mailbox の badge counts + mailbox_id を取得.
 * vars 不要. mailbox.id が以後の API (typing 等) の recipient_id に使える.
 */
export async function getMailboxBadge({ accountName, username, password } = {}) {
  if (!accountName) throw new Error("accountName required");
  const r = await mobileCall({
    accountName, username, password,
    friendly: "InboxFolderBadgeQuery",
    root: "get_slide_mailbox",
    variables: {},
  });
  return r.data?.get_slide_mailbox || null;
}

/**
 * 指定 message_ids の本文を一括取得.
 * @param {string[]} messageIds  ["mid.$..." ...]
 */
export async function readMessages({ accountName, messageIds, username, password } = {}) {
  if (!accountName) throw new Error("accountName required");
  if (!Array.isArray(messageIds) || messageIds.length === 0) throw new Error("messageIds required (string[])");
  const r = await mobileCall({
    accountName, username, password,
    friendly: "BcnInboxMultiMessagesQuery",
    root: "multifetch__SlideMessage",
    variables: { message_ids: messageIds },
  });
  // 配列で返ってくる. 各要素は { node: SlideMessage }
  return (r.data?.multifetch__SlideMessage || []).map((x) => x.node || x);
}

/**
 * 指定 ethmu_ids のユーザー情報を取得.
 * @param {string[]} ethmuIds
 */
export async function getUsers({ accountName, ethmuIds, username, password } = {}) {
  if (!accountName) throw new Error("accountName required");
  if (!Array.isArray(ethmuIds) || ethmuIds.length === 0) throw new Error("ethmuIds required");
  const r = await mobileCall({
    accountName, username, password,
    friendly: "BcnSlideUsersQuery",
    root: "get_slide_users",
    variables: { ethmu_ids: ethmuIds },
  });
  return r.data?.get_slide_users || [];
}

/**
 * 指定 ethmu_ids の reachability (DM 可能か / 制限有無 等).
 */
export async function getReachability({ accountName, ethmuIds, fetchSocialContext = false, username, password } = {}) {
  if (!accountName) throw new Error("accountName required");
  if (!Array.isArray(ethmuIds) || ethmuIds.length === 0) throw new Error("ethmuIds required");
  const r = await mobileCall({
    accountName, username, password,
    friendly: "BcnSlideReachabilityStatusQuery",
    root: "get_slide_users",
    variables: { ethmu_ids: ethmuIds, fetch_social_context: fetchSocialContext },
  });
  return r.data?.get_slide_users || [];
}

// === 表示整形 ===

export function summarizeSlideMessage(node) {
  const c = node.content || {};
  const text = c.xma_text
    || (typeof c.text === "string" ? c.text : null)
    || c.body
    || (c.placeholder ? `[${c.placeholder}]` : null)
    || `[${node.content_type || "?"}]`;
  return {
    id: node.message_id,
    when: node.timestamp_ms ? new Date(Number(node.timestamp_ms)).toISOString() : null,
    from: node.sender?.username || node.sender_fbid,
    text: text,
    thread_fbid: node.thread_fbid,
    content_type: node.content_type,
    reactions: (node.reactions || []).map((r) => ({ user: r.sender_fbid, react: r.reaction })),
    shared_link: c.xma?.target_url || null,
    shared_title: c.xma?.title_text || null,
  };
}
