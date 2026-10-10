// Threads DM 送信 API (BcnSendTextMessageMutation 経由)
//
// 動作:
//   1. instagrapi-bridge で Threads モードログイン → Threads-issued Bearer 取得
//   2. Bearer を accounts/threads_accounts.json の `<account>.mobile_bearer` にキャッシュ
//   3. POST https://i.instagram.com/graphql_www でメッセージ送信
//
// 必要な権限:
//   送信側アカウントが Threads DM rollout 済 (Frida override 等で強制 ELIGIBLE 化されてればOK)
//
// 制約:
//   - 受信側がメッセージリクエストを承認してないと "Message Request" 扱いに振り分けられる可能性
//   - recipient_fbids は受信者の interop_messaging_user_fbid を使う (fbid_v2 や ig user_id ではない)
import { readFileSync, writeFileSync } from "fs";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { ACCOUNTS_FILE, getAccount } from "../session.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BRIDGE_PY = resolve(__dirname, "../instagrapi-bridge/.venv/bin/python");
const BRIDGE_SCRIPT = resolve(__dirname, "../instagrapi-bridge/bridge.py");

const GRAPHQL_URL = "https://i.instagram.com/graphql_www";
const SEND_TEXT_DOC_ID = "5463537911313768451759551150";
const SEND_PHOTO_DOC_ID = "171274936116350253476733476178";
// 後方互換 (旧名)
const SEND_DOC_ID = SEND_TEXT_DOC_ID;
// 上書き可: THREADS_APP_ID / THREADS_BARCELONA_UA (Meta が rotate した時用)
const THREADS_APP_ID = process.env.THREADS_APP_ID || "238260118697367";
const BARCELONA_UA = process.env.THREADS_BARCELONA_UA
  || "Barcelona 426.0.0.36.67 Android (34/14; 420dpi; 1080x2400; Google/google; sdk_gphone64_arm64; emu64a; ranchu; en_US; 947514750)";

// otid: 64bit unique. snowflake-ish (timestamp_ms << 22 | random)
function generateOtid() {
  const ms = BigInt(Date.now());
  const rand = BigInt(Math.floor(Math.random() * (1 << 22)));
  return ((ms << 22n) | rand).toString();
}

// instagrapi-bridge を呼んで Threads-issued Bearer を取得
function fetchBearerViaBridge({ accountName, username, password }) {
  if (!username || !password) throw new Error("username + password required for Bearer fetch");
  const env = {
    ...process.env,
    INSTAGRAPI_ACCOUNT: accountName,
    INSTAGRAPI_USERNAME: username,
    INSTAGRAPI_PASSWORD: password,
    INSTAGRAPI_THREADS_MODE: "1",  // ★ login 前に Threads モード適用 → Threads-issued Bearer
  };
  const r = spawnSync(BRIDGE_PY, [BRIDGE_SCRIPT, "get-bearer"], { env, encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(`bridge get-bearer failed: ${r.stderr || r.stdout}`);
  }
  const out = JSON.parse(r.stdout.trim());
  if (!out.bearer) throw new Error(`Bearer not returned: ${JSON.stringify(out).slice(0, 200)}`);
  return out;
}

// Bearer を accounts.json にキャッシュ (24h fresh, login 不要 1年程度有効)
export function getOrFetchBearer({ accountName, username, password, forceRefresh = false }) {
  const all = JSON.parse(readFileSync(ACCOUNTS_FILE, "utf8"));
  const acc = all[accountName];
  if (!forceRefresh && acc?.mobile_bearer) {
    return { bearer: acc.mobile_bearer, ds_user_id: acc.ds_user_id || acc.mobile_user_id };
  }
  console.log(`[dm] fetching new Threads-issued Bearer for ${accountName}...`);
  const out = fetchBearerViaBridge({ accountName, username, password });
  // accounts.json に保存
  all[accountName] = {
    ...(all[accountName] || {}),
    username: username || all[accountName]?.username,
    mobile_bearer: out.bearer,
    mobile_user_id: out.user_id,
    mobile_bearer_fetched_at: new Date().toISOString(),
  };
  writeFileSync(ACCOUNTS_FILE, JSON.stringify(all, null, 2) + "\n");
  console.log(`[dm] Bearer cached. user_id=${out.user_id}`);
  return { bearer: out.bearer, ds_user_id: out.user_id };
}

/**
 * DM テキスト送信
 *
 * @param {object} opts
 * @param {string} opts.accountName    送信元アカウント (hiroai 等)
 * @param {string} [opts.recipientFbid] 受信者の interop_messaging_user_fbid
 * @param {string} [opts.threadFbid]    既存スレッド fbid (recipient とどちらか)
 * @param {string} opts.text           送信テキスト
 * @param {string} [opts.username]     Bearer 取得用 (初回のみ)
 * @param {string} [opts.password]     Bearer 取得用 (初回のみ)
 * @param {string} [opts.replyToId]    返信元 message_id
 */
export async function sendDM({ accountName, recipientFbid, threadFbid, text, username, password, replyToId } = {}) {
  if (!accountName) throw new Error("accountName required");
  if (!text) throw new Error("text required");
  if (!recipientFbid && !threadFbid) throw new Error("recipientFbid or threadFbid required");

  const { bearer } = getOrFetchBearer({ accountName, username, password });

  const variables = {
    offline_threading_id: generateOtid(),
    text_body: { sensitive_string_value: text },
    logging_data: { nav_chain: "BcnRoute:ig_text_feed_timeline:1:cold_start:0:0:0" },
    replied_to_message_id: replyToId || null,
    forwarded_message_id: null,
    mentioned_users: [],
  };
  if (threadFbid) variables.thread_fbid = String(threadFbid);
  if (recipientFbid) variables.recipient_fbids = [String(recipientFbid)];

  const body = new URLSearchParams({
    client_doc_id: SEND_DOC_ID,
    variables: JSON.stringify(variables),
  }).toString();

  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      "User-Agent": BARCELONA_UA,
      Authorization: bearer,
      "X-FB-Friendly-Name": "BcnSendTextMessageMutation",
      "X-Root-Field-Name": "send_slide_text_message",
      "x-graphql-client-library": "pando",
      "X-IG-App-ID": THREADS_APP_ID,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    redirect: "manual",
  });

  const raw = await res.text();
  let json;
  try { json = JSON.parse(raw); } catch { json = { _raw: raw.slice(0, 400) }; }

  return { http: res.status, json };
}

// instagrapi-bridge で画像 upload して upload_id 取得
function uploadPhotoViaBridge({ accountName, imagePath, username, password }) {
  const env = {
    ...process.env,
    INSTAGRAPI_ACCOUNT: accountName,
    INSTAGRAPI_USERNAME: username || process.env.THREADS_USERNAME || "x",
    INSTAGRAPI_PASSWORD: password || process.env.THREADS_PASSWORD || "x",
    INSTAGRAPI_THREADS_MODE: "1",
  };
  const r = spawnSync(BRIDGE_PY, [BRIDGE_SCRIPT, "photo-upload", imagePath], { env, encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(`bridge photo-upload failed: ${r.stderr || r.stdout}`);
  }
  const out = JSON.parse(r.stdout.trim());
  if (!out.upload_id) throw new Error(`upload_id not returned: ${JSON.stringify(out).slice(0, 200)}`);
  return out;
}

/**
 * 画像 DM 送信 (BcnSendPhotoMessageMutation)
 *
 * フロー:
 *   1. instagrapi-bridge で画像を rupload_igphoto に upload → upload_id
 *   2. POST i.instagram.com/graphql_www (BcnSendPhotoMessageMutation) with upload_id
 *
 * @param {object} opts
 * @param {string} opts.accountName    送信元アカウント
 * @param {string} opts.imagePath      ローカル画像 path (jpg/png)
 * @param {string} [opts.recipientFbid] interop_messaging_user_fbid
 * @param {string} [opts.threadFbid]    既存 thread_fbid
 * @param {string} [opts.caption]       画像と一緒に送るテキスト (optional)
 * @param {string} [opts.username]     Bearer 取得用 (初回のみ)
 * @param {string} [opts.password]     Bearer 取得用 (初回のみ)
 * @param {string} [opts.replyToId]    返信元 message_id
 */
export async function sendPhotoDM({ accountName, imagePath, recipientFbid, threadFbid, caption, username, password, replyToId } = {}) {
  if (!accountName) throw new Error("accountName required");
  if (!imagePath) throw new Error("imagePath required");
  if (!recipientFbid && !threadFbid) throw new Error("recipientFbid or threadFbid required");

  // Step 1: upload
  console.log(`[dm] uploading photo via instagrapi-bridge...`);
  const upload = uploadPhotoViaBridge({ accountName, imagePath, username, password });
  console.log(`[dm] uploaded: upload_id=${upload.upload_id} ${upload.width}x${upload.height} ${upload.size_bytes}B`);

  // Step 2: send
  const { bearer } = getOrFetchBearer({ accountName, username, password });

  const variables = {
    offline_threading_id: generateOtid(),
    upload_id: upload.upload_id,
    media_height: upload.height,
    media_width: upload.width,
    logging_data: { nav_chain: "BcnRoute:ig_text_feed_timeline:1:cold_start:0:0:0" },
    replied_to_message_id: replyToId || null,
    forwarded_message_id: null,
    mentioned_users: [],
  };
  if (caption) variables.text_body = { sensitive_string_value: caption };
  if (threadFbid) variables.thread_fbid = String(threadFbid);
  if (recipientFbid) variables.recipient_fbids = [String(recipientFbid)];

  const body = new URLSearchParams({
    client_doc_id: SEND_PHOTO_DOC_ID,
    variables: JSON.stringify(variables),
  }).toString();

  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      "User-Agent": BARCELONA_UA,
      Authorization: bearer,
      "X-FB-Friendly-Name": "BcnSendPhotoMessageMutation",
      "X-Root-Field-Name": "send_slide_photo_message",
      "x-graphql-client-library": "pando",
      "X-IG-App-ID": THREADS_APP_ID,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    redirect: "manual",
  });

  const raw = await res.text();
  let json;
  try { json = JSON.parse(raw); } catch { json = { _raw: raw.slice(0, 400) }; }

  return { http: res.status, json, upload };
}
