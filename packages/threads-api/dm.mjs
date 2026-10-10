// Threads DM 送信 CLI
//
// テキスト DM:
//   node --env-file=.env dm.mjs --to <username> "テキスト"          ← username から fbid 解決
//   node --env-file=.env dm.mjs --to-pk <threads_pk> "テキスト"     ← Threads pk から fbid 解決 (バッチ送信向け. user_search 不要)
//   node --env-file=.env dm.mjs --to-fbid <interop_fbid> "テキスト"  ← 解決済 fbid を直接指定
//   node --env-file=.env dm.mjs --thread <thread_fbid> "テキスト"   ← 既存スレッドへ
//
// 画像 DM (ローカル jpg/png):
//   node --env-file=.env dm.mjs --to <username> --image /path/to/img.jpg "キャプション"
//   node --env-file=.env dm.mjs --to-fbid <interop_fbid> --image f.jpg
//
// account は --account or env THREADS_ACCOUNT 必須.
//
// .env: THREADS_USERNAME / THREADS_PASSWORD (= 送信元 IG login credentials, 初回のみ)
import { sendDM, sendPhotoDM } from "./lib/dms.mjs";
import { getInteropFbidByUsername, getInteropFbidMulti } from "./lib/user_lookup.mjs";
import { isWebCookieAlive, findAliveWebAccount } from "./lib/web_session_health.mjs";
import { searchUsers } from "./lib/user_search.mjs";

const args = process.argv.slice(2);
let accountName = process.env.THREADS_ACCOUNT || null;
let recipientFbid = null;
let threadFbid = null;
let replyToId = null;
let imagePath = null;
let toUsername = null;
let toPk = null;
const positional = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--account") { accountName = args[++i]; continue; }
  if (a === "--to") { toUsername = args[++i]; continue; }
  if (a === "--to-pk") { toPk = args[++i]; continue; }
  if (a === "--to-fbid") { recipientFbid = args[++i]; continue; }
  if (a === "--thread") { threadFbid = args[++i]; continue; }
  if (a === "--reply") { replyToId = args[++i]; continue; }
  if (a === "--image") { imagePath = args[++i]; continue; }
  positional.push(a);
}

const text = positional.join(" ").trim();
const username = process.env.THREADS_USERNAME;
const password = process.env.THREADS_PASSWORD;

if (!accountName) {
  console.error("ERROR: --account <name> または env THREADS_ACCOUNT が必要");
  process.exit(1);
}

// --to-pk <threads_pk> 指定時は username 経由をスキップして直接 interop_fbid 解決
// (バッチ送信時にあらかじめ searchUsers で pk が分かってる場合に最も確実)
if (toPk && !recipientFbid && !threadFbid) {
  console.log(`[dm] resolving pk=${toPk} → interop_messaging_user_fbid...`);
  try {
    const r = await getInteropFbidMulti({ candidates: [String(toPk)], viaAccount: accountName });
    if (r?.interop_messaging_user_fbid) {
      recipientFbid = r.interop_messaging_user_fbid;
      const handle = r.username ? `@${r.username}` : `pk=${toPk}`;
      console.log(`[dm] ${handle} → fbid=${recipientFbid}`);
    } else {
      console.error(`ERROR: pk=${toPk} の interop_messaging_user_fbid 取得失敗 (DM rollout 未到達 / DM OFF / pk 無効)`);
      process.exit(1);
    }
  } catch (e) {
    console.error(`ERROR: pk=${toPk} 解決失敗: ${e.message}`);
    process.exit(1);
  }
}

// --to <username> 指定時は内部で user_search → user-info → interop_fbid 解決
if (toUsername && !recipientFbid && !threadFbid) {
  console.log(`[dm] resolving @${toUsername} → interop_messaging_user_fbid...`);
  // accounts.json + instagrapi 両方の candidate を試す getInteropFbidByUsername
  const r = await getInteropFbidByUsername({ username: toUsername, viaAccount: accountName });
  if (r?.interop_messaging_user_fbid) {
    recipientFbid = r.interop_messaging_user_fbid;
    console.log(`[dm] @${toUsername} → fbid=${recipientFbid}`);
  } else {
    // fallback: user_search via web で Threads pk 取得 → IG API で interop fbid 解決
    // 送信元 web cookie が死んでる場合は別アカウントで lookup (送信本体は元アカウント Bearer)
    let lookupAccount = accountName;
    if (!(await isWebCookieAlive(accountName))) {
      const alt = await findAliveWebAccount({ exclude: [accountName] });
      if (alt) {
        console.log(`[dm] @${accountName} の web cookie 死亡 → @${alt} で lookup する`);
        lookupAccount = alt;
      } else {
        console.error(`WARN: @${accountName} web cookie 死亡 + 他アカウントの web cookie も全て死亡. user_search fallback を強行 (失敗する可能性高)`);
      }
    }
    try {
      const usResult = await searchUsers({ accountName: lookupAccount, query: toUsername, first: 5 });
      const matched = usResult.users.find((u) => String(u.username).toLowerCase() === toUsername.toLowerCase());
      if (matched?.pk) {
        const r2 = await getInteropFbidMulti({ candidates: [matched.pk], viaAccount: accountName });
        if (r2?.interop_messaging_user_fbid) {
          recipientFbid = r2.interop_messaging_user_fbid;
          const via = lookupAccount === accountName ? "web user_search" : `web user_search via @${lookupAccount}`;
          console.log(`[dm] @${toUsername} → fbid=${recipientFbid} (${via})`);
        }
      } else {
        console.error(`WARN: web user_search で @${toUsername} 該当なし`);
      }
    } catch (e) {
      const msg = String(e?.message || e);
      if (/redirect count exceeded|fb_dtsg|lsd/i.test(msg)) {
        console.error(`ERROR: web user_search 失敗 (web cookie 期限切れの可能性): ${msg}`);
        console.error(`HINT: 全アカウントの web cookie が死亡してる. login_cdp.mjs か Chrome cookie import で再ログイン要`);
      } else {
        console.error(`ERROR: web user_search 失敗: ${msg}`);
      }
    }
  }
  if (!recipientFbid) {
    console.error(`ERROR: @${toUsername} の interop_messaging_user_fbid 取得失敗 (DM rollout 未到達 / DM OFF アカウント / web cookie 全滅)`);
    process.exit(1);
  }
}

if (!recipientFbid && !threadFbid) {
  console.error("ERROR: --to <username> / --to-pk <threads_pk> / --to-fbid <fbid> / --thread <thread_fbid> いずれか必要");
  process.exit(1);
}
if (!text && !imagePath) {
  console.error('usage:');
  console.error('  text:  node dm.mjs --to-fbid FBID "<text>"');
  console.error('  image: node dm.mjs --to-fbid FBID --image <path> ["caption"]');
  process.exit(1);
}

const target = recipientFbid ? `to=${recipientFbid}` : `thread=${threadFbid}`;

if (imagePath) {
  // 画像 DM
  console.log(`[dm] account=${accountName} ${target} image="${imagePath}" caption="${text.slice(0, 60)}"`);
  const r = await sendPhotoDM({
    accountName, recipientFbid, threadFbid, imagePath, caption: text || null, replyToId,
    username, password,
  });
  console.log(`HTTP ${r.http}`);
  const m = r.json?.data?.send_slide_photo_message;
  if (m?.message_id) {
    console.log(`✅ msg_id: ${m.message_id}`);
    console.log(`   timestamp: ${m.timestamp}`);
    console.log(`   upload_id: ${r.upload?.upload_id}`);
    process.exit(0);
  }
  console.error("FAIL:");
  console.error(JSON.stringify(r.json, null, 2).slice(0, 800));
  process.exit(1);
} else {
  // テキスト DM
  console.log(`[dm] account=${accountName} ${target} text="${text.slice(0, 60)}"`);
  const r = await sendDM({
    accountName, recipientFbid, threadFbid, text, replyToId,
    username, password,
  });
  console.log(`HTTP ${r.http}`);
  if (r.json?.data?.send_slide_text_message?.message_id) {
    const m = r.json.data.send_slide_text_message;
    console.log(`✅ msg_id: ${m.message_id}`);
    console.log(`   timestamp: ${m.timestamp}`);
    process.exit(0);
  }
  console.error("FAIL:");
  console.error(JSON.stringify(r.json, null, 2).slice(0, 800));
  process.exit(1);
}
