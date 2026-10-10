// Threads テキスト投稿: POST /api/v1/media/configure_text_only_post/
// Threads 画像投稿:    POST /api/v1/media/configure_text_post_app_feed/
// Threads 投稿削除:    web GraphQL useTHDeletePostMutation
import { randomUUID } from "crypto";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { getAccount } from "../session.mjs";
import { browserHeaders, IG_APP_ID, ASBD_ID } from "./http.mjs";
import { computeJazoest } from "./encryption.mjs";
import { callGraphQL, normalizePk } from "./graphql.mjs";
import {
  jitter,
  getOrCreateWebSessionId,
  getCachedTokens,
  cacheTokens,
  extractFbTokens,
  httpFetch,
} from "./fingerprint.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BRIDGE_PY = resolve(__dirname, "../instagrapi-bridge/.venv/bin/python");
const BRIDGE_SCRIPT = resolve(__dirname, "../instagrapi-bridge/bridge.py");

const POST_URL = "https://www.threads.com/api/v1/media/configure_text_only_post/";
const PHOTO_POST_URL = "https://www.threads.com/api/v1/media/configure_text_post_app_feed/";
const SIDECAR_POST_URL = "https://www.threads.com/api/v1/media/configure_text_post_app_sidecar/";

// 必要に応じてホーム HTML から fb_dtsg / lsd を取得 (キャッシュ)
async function ensureFbTokens(acc, accountName) {
  const cached = getCachedTokens(accountName);
  if (cached?.fb_dtsg) return cached;
  const res = await httpFetch("https://www.threads.com/", {
    headers: browserHeaders({
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      Cookie: acc.cookies,
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-User": "?1",
      "Upgrade-Insecure-Requests": "1",
    }),
    redirect: "manual",
  });
  const html = await res.text();
  const tokens = extractFbTokens(html);
  cacheTokens(accountName, tokens);
  return tokens;
}

// 返信先 pk を pk / strong_id / shortcode / URL から正規化
function normalizeReplyId(input) {
  if (input == null) return null;
  const s = String(input);
  if (/^\d+$/.test(s)) return s;
  const m1 = s.match(/^(\d+)_\d+$/);
  if (m1) return m1[1];
  const m2 = s.match(/threads\.com\/@[^/]+\/post\/([A-Za-z0-9_-]+)/);
  if (m2) {
    // shortcode → pk 変換は別途必要. ここでは shortcode のままだと NG なのでエラー
    throw new Error(`reply_to に shortcode/URL 渡された (${m2[1]}). pk (numeric) で指定してください. 例: 3883038545900952856`);
  }
  throw new Error(`unrecognized reply_to: ${input}`);
}

/**
 * Threads テキスト投稿 / 投票 / 添付テキスト (snippet) / 返信 / ツリー投稿
 *
 * @param {object} opts
 * @param {string} opts.accountName
 * @param {string} opts.text                投稿テキスト (snippet/poll 時は短いキャプション)
 * @param {object} [opts.poll]              投票指定. { question, choices: ["A","B",...] }
 * @param {string|object} [opts.snippet]    添付テキスト (長文 rich-text)
 * @param {number} [opts.replyControl]
 * @param {string} [opts.audience]
 * @param {string|number} [opts.replyToId]
 * @param {string} [opts.selfThreadContextId] ツリー投稿で共通の UUID を上書き (createThreadChain が使用)
 */
export async function createTextPost({ accountName, text, poll = null, snippet = null, quotedPostId = null, topic = null, gifMediaId = null, replyControl = 0, audience = "default", replyToId = null, selfThreadContextId = null, skipJitter = false } = {}) {
  if (!text && !poll && !snippet && !quotedPostId && !gifMediaId) throw new Error("text / poll / snippet / quotedPostId / gifMediaId いずれか必要");
  if (text && typeof text !== "string") throw new Error("text must be string");
  const acc = getAccount(accountName);
  if (!acc.csrftoken || !acc.cookies) throw new Error("account missing csrftoken/cookies — refresh first");

  if (!skipJitter) await jitter();
  const tokens = await ensureFbTokens(acc, accountName);

  const replyPk = replyToId ? normalizeReplyId(replyToId) : null;

  const csrftoken = acc.csrftoken;
  const sessionId = getOrCreateWebSessionId(accountName);
  const uploadId = String(Date.now());
  const ctxId = selfThreadContextId || randomUUID();

  // ★ snippet 構築
  // 文字列指定 → plain テキスト 1セグメント
  // オブジェクト指定 → segments[] でセグメント単位の styling
  let snippetAttachment = null;
  if (snippet) {
    if (typeof snippet === "string") {
      snippetAttachment = {
        link_attachment_url: null,
        plaintext: snippet,
        text_with_styling_info: [{
          display_text: snippet, offset: 0,
          styling_info: { is_bold: false, is_highlight: false, is_italic: false, is_strikethrough: false, is_underline: false },
        }],
      };
    } else if (snippet && typeof snippet === "object" && Array.isArray(snippet.segments)) {
      let off = 0;
      const segs = snippet.segments.map((s) => {
        const t = String(s.text || "");
        const seg = {
          display_text: t, offset: off,
          styling_info: {
            is_bold: !!s.bold, is_highlight: !!s.highlight, is_italic: !!s.italic,
            is_strikethrough: !!s.strikethrough, is_underline: !!s.underline,
          },
        };
        off += t.length;
        return seg;
      });
      snippetAttachment = {
        link_attachment_url: snippet.link_attachment_url ?? null,
        plaintext: snippet.plaintext ?? snippet.segments.map((s) => s.text).join(""),
        text_with_styling_info: segs,
      };
    }
  }

  const textPostAppInfo = {
    community_flair_id: null,
    entry_point: replyPk ? "create_reply" : "top_of_feed",
    excluded_inline_media_ids: "[]",
    fediverse_composer_enabled: true,
    is_reply_approval_enabled: false,
    is_spoiler_media: false,
    // snippet 付きの時 link_attachment_url は省く (web 実通信に厳密一致)
    ...(snippetAttachment ? {} : { link_attachment_url: null }),
    link_preview_default_render_style: null,
    reply_control: replyControl,
    ...(replyPk ? { reply_id: replyPk } : {}),
    ...(quotedPostId ? { quoted_post_id: String(quotedPostId).match(/\d+/)?.[0] || String(quotedPostId) } : {}),
    self_thread_context_id: ctxId,
    snippet_attachment: snippetAttachment,
    special_effects_enabled_str: null,
    tag_header: topic ? { display_text: String(topic) } : null,
    text_with_entities: { entities: [], text: text || "" },
    ...(gifMediaId ? { gif_media_id: String(gifMediaId) } : {}),
  };

  // ★ URL preview: text に URL あれば自動で link_attachment_url 上書き
  // (web 実通信に厳密一致). 引用投稿時は link_attachment_url 自体送らない (web 仕様).
  if (!quotedPostId) {
    const m = (text || "").match(/https?:\/\/[^\s]+/);
    if (m) {
      textPostAppInfo.link_attachment_url = m[0];
    }
  }

  // ★ poll 指定があれば caption_add_on に poll JSON 投入
  // 形式: { poll: { question, tallies: [{text}, ...] } }
  let captionAddOn = "";
  if (poll) {
    if (!poll.choices || !Array.isArray(poll.choices) || poll.choices.length < 2) {
      throw new Error("poll.choices required (>=2 strings)");
    }
    captionAddOn = JSON.stringify({
      poll: {
        question: poll.question || "",
        tallies: poll.choices.map((c) => ({ text: String(c) })),
      },
    });
  }

  const body = new URLSearchParams({
    async_publish: "",
    audience,
    barcelona_source_reply_id: replyPk || "",
    caption: text || "",
    chain_id: "",
    chain_index: "",
    chain_length: "",
    creator_geo_gating_info: JSON.stringify({ whitelist_country_codes: [] }),
    cross_share_info: "",
    custom_accessibility_caption: "",
    gen_ai_detection_method: "",
    internal_features: "",
    is_meta_only_post: "",
    is_paid_partnership: "",
    is_upload_type_override_allowed: "1",
    music_params: "",
    publish_mode: "text_post",
    should_include_permalink: "true",
    text_post_app_info: JSON.stringify(textPostAppInfo),
    upload_id: uploadId,
    web_session_id: sessionId,
    ...(captionAddOn ? { caption_add_on: captionAddOn } : {}),
    jazoest: computeJazoest(csrftoken),
  }).toString();

  const headers = browserHeaders({
    Accept: "*/*",
    "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    Origin: "https://www.threads.com",
    Referer: "https://www.threads.com/",
    "X-CSRFToken": csrftoken,
    "X-IG-App-ID": IG_APP_ID,
    "X-ASBD-ID": ASBD_ID,
    "X-Web-Session-ID": sessionId,
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    Cookie: acc.cookies,
  });
  if (tokens?.fb_dtsg) headers["X-FB-DTSG"] = tokens.fb_dtsg;
  if (tokens?.lsd) headers["X-FB-LSD"] = tokens.lsd;

  const res = await httpFetch(POST_URL, { method: "POST", headers, body, redirect: "manual" });
  const raw = await res.text();
  let json;
  try { json = JSON.parse(raw); } catch { json = { _raw: raw.slice(0, 500) }; }

  return { http: res.status, json };
}

// instagrapi-bridge 経由で画像 upload → upload_id 取得
function uploadPhotoViaBridge({ accountName, imagePath, username, password }) {
  const env = {
    ...process.env,
    INSTAGRAPI_ACCOUNT: accountName,
    INSTAGRAPI_USERNAME: username || process.env.THREADS_USERNAME || "x",
    INSTAGRAPI_PASSWORD: password || process.env.THREADS_PASSWORD || "x",
    INSTAGRAPI_THREADS_MODE: "1",
  };
  const r = spawnSync(BRIDGE_PY, [BRIDGE_SCRIPT, "photo-upload", imagePath], { env, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`bridge photo-upload failed: ${r.stderr || r.stdout}`);
  const out = JSON.parse(r.stdout.trim());
  if (!out.upload_id) throw new Error(`upload_id not returned`);
  return out;
}

/**
 * Threads 画像投稿 (POST /api/v1/media/configure_text_post_app_feed/)
 *
 * フロー:
 *   1. instagrapi-bridge で画像を rupload_igphoto → upload_id
 *   2. POST configure_text_post_app_feed with publish_mode=media + upload_id
 *
 * @param {object} opts
 * @param {string} opts.accountName    投稿元アカウント
 * @param {string} opts.imagePath      ローカル画像 path (jpg/png)
 * @param {string} [opts.text]         キャプション (空文字も OK)
 * @param {number} [opts.replyControl] 0=everyone, 1=mentioned_only, 2=followed
 * @param {string} [opts.audience]
 * @param {string|number} [opts.replyToId]
 */
/**
 * カルーセル投稿 (複数画像 1 投稿 = sidecar)
 *
 * フロー:
 *   1. 各画像を instagrapi-bridge で rupload_igphoto → upload_id 取得
 *   2. POST /api/v1/media/configure_text_post_app_sidecar/  (JSON body, Content-Type: text/plain)
 *   3. children_metadata に各 upload_id を並べる
 *
 * @param {object} opts
 * @param {string} opts.accountName
 * @param {string[]} opts.imagePaths   2 枚以上の画像 path
 * @param {string} [opts.text]         キャプション (optional)
 * @param {number} [opts.replyControl] 0=everyone 1=mentioned_only 2=followed
 * @param {string} [opts.audience]
 * @param {string|number} [opts.replyToId]
 */
export async function createCarouselPost({ accountName, imagePaths, text = "", replyControl = 0, audience = "default", replyToId = null, spoiler = false } = {}) {
  if (!Array.isArray(imagePaths) || imagePaths.length < 2) {
    throw new Error("imagePaths array (>=2) required for carousel");
  }
  const acc = getAccount(accountName);
  if (!acc.csrftoken || !acc.cookies) throw new Error("account missing csrftoken/cookies — refresh first");

  // Step 1: upload all photos
  const uploads = [];
  for (let i = 0; i < imagePaths.length; i++) {
    console.log(`[post] uploading photo ${i + 1}/${imagePaths.length}: ${imagePaths[i]}`);
    const u = uploadPhotoViaBridge({ accountName, imagePath: imagePaths[i] });
    console.log(`[post]   upload_id=${u.upload_id} ${u.width}x${u.height}`);
    uploads.push(u);
  }

  // Step 2: configure sidecar
  await jitter();
  const tokens = await ensureFbTokens(acc, accountName);

  const replyPk = replyToId ? normalizeReplyId(replyToId) : null;
  const csrftoken = acc.csrftoken;
  const sessionId = getOrCreateWebSessionId(accountName);
  const selfThreadContextId = randomUUID();
  const clientSidecarId = String(Date.now());

  const textPostAppInfo = {
    community_flair_id: null,
    entry_point: replyPk ? "create_reply" : "top_of_feed",
    excluded_inline_media_ids: "[]",
    fediverse_composer_enabled: true,
    gif_media_id: null,
    is_reply_approval_enabled: false,
    is_spoiler_media: !!spoiler,
    link_attachment_url: null,
    link_preview_default_render_style: null,
    reply_control: replyControl,
    ...(replyPk ? { reply_id: replyPk } : {}),
    self_thread_context_id: selfThreadContextId,
    snippet_attachment: null,
    special_effects_enabled_str: null,
    tag_header: null,
    text_with_entities: { entities: [], text: text || "" },
  };

  // ★ JSON body (form-urlencoded じゃない. Content-Type: text/plain)
  const bodyObj = {
    audience,
    caption: text || "",
    children_metadata: uploads.map((u) => ({ upload_id: u.upload_id })),
    client_sidecar_id: clientSidecarId,
    creator_geo_gating_info: JSON.stringify({ whitelist_country_codes: [] }),
    internal_features: "",
    is_threads: true,
    is_upload_type_override_allowed: "1",
    should_include_permalink: true,
    text_post_app_info: JSON.stringify(textPostAppInfo),
    web_session_id: sessionId,
  };
  const body = JSON.stringify(bodyObj);

  const headers = browserHeaders({
    Accept: "*/*",
    "Content-Type": "text/plain;charset=UTF-8",
    Origin: "https://www.threads.com",
    Referer: "https://www.threads.com/",
    "X-CSRFToken": csrftoken,
    "X-IG-App-ID": IG_APP_ID,
    "X-ASBD-ID": ASBD_ID,
    "X-Web-Session-ID": sessionId,
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    Cookie: acc.cookies,
  });
  if (tokens?.fb_dtsg) headers["X-FB-DTSG"] = tokens.fb_dtsg;
  if (tokens?.lsd) headers["X-FB-LSD"] = tokens.lsd;

  const res = await httpFetch(SIDECAR_POST_URL, { method: "POST", headers, body, redirect: "manual" });
  const raw = await res.text();
  let json;
  try { json = JSON.parse(raw); } catch { json = { _raw: raw.slice(0, 500) }; }

  return { http: res.status, json, uploads };
}

/**
 * ツリー投稿 (連続自己 reply) を一発で作る. 全ポスト同じ self_thread_context_id を共有.
 *
 * @param {object} opts
 * @param {string} opts.accountName
 * @param {string[]|object[]} opts.posts  各エントリは string か { text, snippet, poll, image, replyControl } (image は createPhotoPost 経由)
 * @param {number} [opts.delayMs]         各 post 間の待機 (default 1500ms, rate limit 抑制)
 * @returns {Promise<{ pks: string[], codes: string[], rootPk: string, contextId: string }>}
 */
export async function createThreadChain({ accountName, posts, delayMs = 1500 } = {}) {
  if (!Array.isArray(posts) || posts.length === 0) throw new Error("posts (array) required");
  const ctxId = randomUUID();
  const pks = [];
  const codes = [];
  let prevPk = null;

  for (let i = 0; i < posts.length; i++) {
    const p = typeof posts[i] === "string" ? { text: posts[i] } : posts[i];
    if (i > 0) await new Promise((r) => setTimeout(r, delayMs));

    let r;
    if (p.image) {
      // 画像 chain は selfThreadContextId をまだ photo post 側に通してないので
      // 簡易対応: 画像投稿は chain root として最初のポストに、または別途チェイン共有なしで投稿.
      // ここでは reply 経由で chain に組み込む (web の挙動と合致).
      r = await createPhotoPost({
        accountName, imagePath: p.image, text: p.text || "",
        replyControl: p.replyControl ?? 0, replyToId: prevPk,
      });
    } else {
      r = await createTextPost({
        accountName,
        text: p.text || "",
        poll: p.poll || null,
        snippet: p.snippet || null,
        replyControl: p.replyControl ?? 0,
        replyToId: prevPk,
        selfThreadContextId: ctxId,
      });
    }

    const m = r.json?.media;
    if (!m?.pk) {
      const err = JSON.stringify(r.json).slice(0, 300);
      throw new Error(`thread chain post ${i} failed: HTTP ${r.http} ${err}`);
    }
    pks.push(m.pk);
    codes.push(m.code);
    prevPk = m.pk;
  }

  return { pks, codes, rootPk: pks[0], contextId: ctxId };
}

export async function createPhotoPost({ accountName, imagePath, text = "", replyControl = 0, audience = "default", replyToId = null, spoiler = false } = {}) {
  if (!imagePath) throw new Error("imagePath required");
  const acc = getAccount(accountName);
  if (!acc.csrftoken || !acc.cookies) throw new Error("account missing csrftoken/cookies — refresh first");

  // Step 1: upload
  console.log(`[post] uploading photo via instagrapi-bridge...`);
  const upload = uploadPhotoViaBridge({ accountName, imagePath });
  console.log(`[post] uploaded: upload_id=${upload.upload_id} ${upload.width}x${upload.height} ${upload.size_bytes}B`);

  // Step 2: configure
  await jitter();
  const tokens = await ensureFbTokens(acc, accountName);

  const replyPk = replyToId ? normalizeReplyId(replyToId) : null;
  const csrftoken = acc.csrftoken;
  const sessionId = getOrCreateWebSessionId(accountName);
  const selfThreadContextId = randomUUID();

  // ★ 画像投稿の text_post_app_info は gif_media_id を含む (text-only と差分)
  const textPostAppInfo = {
    community_flair_id: null,
    entry_point: replyPk ? "create_reply" : "top_of_feed",
    excluded_inline_media_ids: "[]",
    fediverse_composer_enabled: true,
    gif_media_id: null,
    is_reply_approval_enabled: false,
    is_spoiler_media: !!spoiler,
    link_attachment_url: null,
    link_preview_default_render_style: null,
    reply_control: replyControl,
    ...(replyPk ? { reply_id: replyPk } : {}),
    self_thread_context_id: selfThreadContextId,
    snippet_attachment: null,
    special_effects_enabled_str: null,
    tag_header: null,
    text_with_entities: { entities: [], text: text || "" },
  };

  // ★ web 実通信 capture に厳密一致 (publish_mode / width / height は送らない. is_threads:true 必須)
  const body = new URLSearchParams({
    async_publish: "",
    audience,
    barcelona_source_reply_id: replyPk || "",
    caption: text || "",
    chain_id: "",
    chain_index: "",
    chain_length: "",
    creator_geo_gating_info: JSON.stringify({ whitelist_country_codes: [] }),
    cross_share_info: "",
    custom_accessibility_caption: "",
    gen_ai_detection_method: "",
    internal_features: "",
    is_meta_only_post: "",
    is_paid_partnership: "",
    is_threads: "true",
    is_upload_type_override_allowed: "1",
    music_params: "",
    should_include_permalink: "true",
    text_post_app_info: JSON.stringify(textPostAppInfo),
    upload_id: upload.upload_id,
    usertags: "",
    web_session_id: sessionId,
    jazoest: computeJazoest(csrftoken),
  }).toString();

  const headers = browserHeaders({
    Accept: "*/*",
    "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    Origin: "https://www.threads.com",
    Referer: "https://www.threads.com/",
    "X-CSRFToken": csrftoken,
    "X-IG-App-ID": IG_APP_ID,
    "X-ASBD-ID": ASBD_ID,
    "X-Web-Session-ID": sessionId,
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    Cookie: acc.cookies,
  });
  if (tokens?.fb_dtsg) headers["X-FB-DTSG"] = tokens.fb_dtsg;
  if (tokens?.lsd) headers["X-FB-LSD"] = tokens.lsd;

  const res = await httpFetch(PHOTO_POST_URL, { method: "POST", headers, body, redirect: "manual" });
  const raw = await res.text();
  let json;
  try { json = JSON.parse(raw); } catch { json = { _raw: raw.slice(0, 500) }; }

  return { http: res.status, json, upload };
}

/**
 * Threads 投稿削除 (web GraphQL useTHDeletePostMutation)
 * @param {object} opts
 * @param {string} opts.accountName  投稿の所有アカウント
 * @param {string|number} opts.mediaId  投稿の pk (numeric) / strong_id どちらでも
 */
export async function deletePost({ accountName, mediaId } = {}) {
  if (!mediaId) throw new Error("mediaId required");
  const pk = normalizePk(mediaId);
  const acc = getAccount(accountName);
  const referer = acc.username ? `https://www.threads.com/@${acc.username}` : "https://www.threads.com/";
  return await callGraphQL({
    accountName,
    friendlyName: "useTHDeletePostMutation",
    variables: { mediaID: pk },
    referer,
    crn: "comet.threads.BarcelonaProfileThreadsColumnRoute",
  });
}
