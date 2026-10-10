// Threads セッションリフレッシュ: username/password で再ログインして cookies を更新
//
// 使い方:
//   node --env-file=.env refresh_session.mjs <accountName>
//   node --env-file=.env refresh_session.mjs <accountName> --force  → 強制再ログイン (チャレンジ復旧用)
//
// account は positional arg or env THREADS_ACCOUNT.
//
// 通常運用では check_session.mjs --auto-refresh を使うこと.
// このスクリプトを直接呼ぶ場合も、デフォルトでは:
//   1) 既存セッションが生きていれば再ログインせず終了 (exit 0)
//   2) 最後の refresh から 6時間以内なら拒否 (exit 1)  ← Meta challenge 防止
//
// .env: THREADS_USERNAME / THREADS_PASSWORD
//
// pub key の扱い:
//   - 通常: accounts/threads_accounts.json の "_encryption" に保管した値で暗号化
//   - rotation 検知: 失敗レスポンスの ig-set-password-encryption-* ヘッダに新 pub key があれば
//                    1回だけ新キーで再試行 → 成功すれば _encryption を上書き
//   - 成功レスポンスで返ってくる pub key も毎回保存（次回以降のローテに備える）
//
// 流れ:
//   1) GET /login で初期 csrftoken / ig_did / mid を取得
//   2) 保管 pub key で password を NaCl sealedbox + AES-256-GCM 暗号化 → POST login
//   3) 失敗 + ヘッダに別 pub key → 新キーで再試行（rotation handling）
//   4) 成功時: cookies + 新 pub key を保存
import { readFileSync, writeFileSync, existsSync, copyFileSync } from "fs";
import { encryptPassword, computeJazoest, SEED_ENCRYPTION } from "./lib/encryption.mjs";
import { parseSetCookies, mergeCookies, serializeCookies, getSetCookieList } from "./lib/cookies.mjs";
import { browserHeaders, ajaxHeaders, authedJsonHeaders, pickEncryptionMeta } from "./lib/http.mjs";
import { jitter, getOrCreateWebSessionId, extractFbTokens, cacheTokens, httpFetch } from "./lib/fingerprint.mjs";
import { ACCOUNTS_FILE } from "./session.mjs";

const LOGIN_URL = "https://www.threads.com/api/v1/web/accounts/login/ajax/";

const argv = process.argv.slice(2);
const force = argv.includes("--force");
const cooldownHours = 6;  // 同 IP からの連続再ログインで Meta challenge を防ぐ
const accountName = argv.find(a => !a.startsWith("--")) || process.env.THREADS_ACCOUNT;
if (!accountName) {
  console.error("ERROR: account name (positional arg) または env THREADS_ACCOUNT が必要");
  process.exit(1);
}

const { THREADS_USERNAME, THREADS_PASSWORD } = process.env;
if (!THREADS_USERNAME || !THREADS_PASSWORD) {
  console.error("ERROR: .env に THREADS_USERNAME / THREADS_PASSWORD が必要");
  process.exit(1);
}
// accounts.json 無ければ空 {} で作る (初回起動時)
if (!existsSync(ACCOUNTS_FILE)) {
  writeFileSync(ACCOUNTS_FILE, "{}\n");
  console.log(`[refresh] created empty ${ACCOUNTS_FILE}`);
}

// ── Pre-flight: 既存セッションが生きてたら再ログイン不要 ──────────────
async function checkSessionAlive(acc) {
  if (!acc?.cookies || !acc?.ds_user_id) return false;
  try {
    const url = `https://www.threads.com/api/v1/users/${acc.ds_user_id}/info/`;
    const res = await httpFetch(url, {
      headers: authedJsonHeaders({ csrftoken: acc.csrftoken, cookie: acc.cookies }),
      redirect: "manual",
    });
    if (res.status !== 200) return false;
    const txt = await res.text();
    const json = JSON.parse(txt);
    return !!(json?.user?.username);
  } catch { return false; }
}

const allCheck = JSON.parse(readFileSync(ACCOUNTS_FILE, "utf8"));
const existing = allCheck[accountName];

if (!force) {
  // 1) 生存チェック: 生きてたら再ログインしない
  if (existing) {
    const alive = await checkSessionAlive(existing);
    if (alive) {
      console.log(`[refresh] ✓ session still alive for "${accountName}" — refresh skipped`);
      console.log(`         use --force to override (only when challenge needs recovery)`);
      process.exit(0);
    }
  }
  // 2) 冷却期間: 直近 N 時間以内に refresh していたら拒否
  if (existing?.refreshedAt) {
    const ageHours = (Date.now() - new Date(existing.refreshedAt).getTime()) / 3600000;
    if (ageHours < cooldownHours) {
      console.error(`[refresh] ✗ last refresh was ${ageHours.toFixed(1)}h ago (cooldown ${cooldownHours}h)`);
      console.error(`         session is dead but too recent to retry — wait or use --force`);
      console.error(`         (連続再ログインは Meta の challenge を発火させる)`);
      process.exit(1);
    }
  }
}
if (force) console.log(`[refresh] ⚠ --force: bypassing alive/cooldown checks`);

let all;
try {
  all = JSON.parse(readFileSync(ACCOUNTS_FILE, "utf8"));
} catch {
  all = {};
}
// _encryption 無ければ同梱 seed を使う (server が rotate して最新値に置き換えてくれる)
const enc = (all._encryption?.pubKeyHex && all._encryption?.keyId && all._encryption?.keyVersion)
  ? all._encryption
  : SEED_ENCRYPTION;
if (!all._encryption) console.log(`[refresh] using bundled SEED_ENCRYPTION (server が rotate して更新します)`);

console.log(`[refresh] account: ${accountName} (${THREADS_USERNAME})`);
console.log(`[refresh] using stored pub key: keyId=${enc.keyId} ver=${enc.keyVersion}`);

// ── Step 1: bootstrap (csrftoken / ig_did / mid cookies + fb_dtsg/lsd) ─
await jitter({ minMs: 400, maxMs: 1200 });
console.log("[refresh] step 1: GET /login (bootstrap csrftoken + tokens)");
const bootRes = await httpFetch("https://www.threads.com/login", {
  headers: browserHeaders({
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
  }),
  redirect: "manual",
});
let bootCookies = parseSetCookies(getSetCookieList(bootRes.headers));
let csrftoken = bootCookies.csrftoken;
if (!csrftoken) {
  console.error("[refresh] initial csrftoken missing");
  console.error("  Set-Cookie keys:", Object.keys(bootCookies));
  process.exit(1);
}
console.log(`[refresh] csrftoken=${csrftoken.slice(0, 12)}...  ig_did=${(bootCookies.ig_did || "").slice(0,16)}...  mid=${(bootCookies.mid || "").slice(0,16)}...`);

// HTML から fb_dtsg / lsd を抽出してキャッシュ (Layer 3 対策)
try {
  const html = await bootRes.text();
  const tokens = extractFbTokens(html);
  if (tokens.fb_dtsg || tokens.lsd) {
    cacheTokens(accountName, tokens);
    console.log(`[refresh] tokens cached: fb_dtsg=${tokens.fb_dtsg ? "ok" : "miss"}  lsd=${tokens.lsd ? "ok" : "miss"}`);
  }
} catch {}

const sessionId = getOrCreateWebSessionId(accountName);

// ── ログイン試行（pub key 指定）──────────────────────────────────────
async function attemptLogin({ pubKey, csrftokenIn, cookiesIn }) {
  const { encPassword } = await encryptPassword({
    password: THREADS_PASSWORD,
    pubKeyHex: pubKey.pubKeyHex,
    keyId: pubKey.keyId,
    keyVersion: pubKey.keyVersion,
  });
  const jazoest = computeJazoest(csrftokenIn);
  const body = new URLSearchParams({
    enc_password: encPassword,
    username: THREADS_USERNAME,
    optIntoOneTap: "false",
    queryParams: "{}",
    stopDeletionNonce: "",
    textAppStopDeletionToken: "",
    can_threads_signup_with_ig: "false",
    jazoest,
  }).toString();

  const res = await httpFetch(LOGIN_URL, {
    method: "POST",
    headers: ajaxHeaders({ csrftoken: csrftokenIn, cookie: serializeCookies(cookiesIn), sessionId }),
    body,
    redirect: "manual",
  });

  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { _raw: text.slice(0, 500) }; }

  return {
    res,
    json,
    setCookies: parseSetCookies(getSetCookieList(res.headers)),
    newPubKey: pickEncryptionMeta(res.headers),
    authorization: res.headers.get("ig-set-authorization") || null,
  };
}

// ── Step 2: 1回目（保管 pub key で）─────────────────────────────────
let pubKey = { pubKeyHex: enc.pubKeyHex, keyId: enc.keyId, keyVersion: enc.keyVersion };
let attempt = await attemptLogin({ pubKey, csrftokenIn: csrftoken, cookiesIn: bootCookies });
console.log(`[refresh] attempt#1: HTTP ${attempt.res.status}  body:`, JSON.stringify(attempt.json).slice(0, 200));

// ── Step 3: rotation 検知（失敗かつ新 pub key 通知あり）→ 再試行 ────
if (!attempt.json.authenticated) {
  const fresh = {
    pubKeyHex: attempt.newPubKey.pubKeyHex,
    keyId: attempt.newPubKey.keyId ? parseInt(attempt.newPubKey.keyId, 10) : null,
    keyVersion: attempt.newPubKey.keyVersion ? parseInt(attempt.newPubKey.keyVersion, 10) : null,
  };
  const rotated =
    fresh.pubKeyHex && fresh.keyId && fresh.keyVersion &&
    (fresh.pubKeyHex !== pubKey.pubKeyHex ||
      fresh.keyId !== pubKey.keyId ||
      fresh.keyVersion !== pubKey.keyVersion);

  if (rotated) {
    console.log(`[refresh] ⚠ pub key rotated by server:`);
    console.log(`  keyId:      ${pubKey.keyId} → ${fresh.keyId}`);
    console.log(`  keyVersion: ${pubKey.keyVersion} → ${fresh.keyVersion}`);
    console.log(`  pubKeyHex:  ${pubKey.pubKeyHex.slice(0,16)}... → ${fresh.pubKeyHex.slice(0,16)}...`);
    console.log(`[refresh] retrying with fresh pub key`);

    // csrftoken / cookies が rotate していれば取り込む
    bootCookies = mergeCookies(bootCookies, attempt.setCookies);
    csrftoken = attempt.setCookies.csrftoken || csrftoken;
    pubKey = fresh;

    attempt = await attemptLogin({ pubKey, csrftokenIn: csrftoken, cookiesIn: bootCookies });
    console.log(`[refresh] attempt#2: HTTP ${attempt.res.status}  body:`, JSON.stringify(attempt.json).slice(0, 200));
  }
}

if (!attempt.json.authenticated) {
  console.error("[refresh] login NOT authenticated");
  if (attempt.json.checkpoint_url) console.error("  checkpoint_url:", attempt.json.checkpoint_url);
  if (attempt.json.message) console.error("  message:", attempt.json.message);
  if (attempt.json.error_type) console.error("  error_type:", attempt.json.error_type);
  if (attempt.json.two_factor_required) console.error("  ★ 2FA required ★");
  process.exit(1);
}

// ── Step 4: 成功 → cookies + 新 pub key を保存 ──────────────────────
const finalCookies = mergeCookies(bootCookies, attempt.setCookies);
const succPubKey = attempt.newPubKey;

copyFileSync(ACCOUNTS_FILE, ACCOUNTS_FILE + ".bak");
console.log(`[refresh] backup: ${ACCOUNTS_FILE}.bak`);

const prev = all[accountName] || {};
all[accountName] = {
  ...prev,
  username: THREADS_USERNAME,
  ds_user_id: finalCookies.ds_user_id || prev.ds_user_id,
  csrftoken: finalCookies.csrftoken,
  ig_did: finalCookies.ig_did || prev.ig_did,
  mid: finalCookies.mid || prev.mid,
  cookies: serializeCookies(finalCookies),
  authorization: attempt.authorization || prev.authorization || null,
  refreshedAt: new Date().toISOString(),
};

// pub key が更新されたら _encryption を保存
const candidate = {
  pubKeyHex: succPubKey.pubKeyHex || pubKey.pubKeyHex,
  keyId: succPubKey.keyId ? parseInt(succPubKey.keyId, 10) : pubKey.keyId,
  keyVersion: succPubKey.keyVersion ? parseInt(succPubKey.keyVersion, 10) : pubKey.keyVersion,
};
const changed =
  candidate.pubKeyHex !== enc.pubKeyHex ||
  candidate.keyId !== enc.keyId ||
  candidate.keyVersion !== enc.keyVersion;
if (changed) {
  all._encryption = {
    ...(all._encryption || {}),
    pubKeyHex: candidate.pubKeyHex,
    keyId: candidate.keyId,
    keyVersion: candidate.keyVersion,
    updatedAt: new Date().toISOString(),
  };
  console.log(`[refresh] _encryption updated: keyId=${candidate.keyId} ver=${candidate.keyVersion}`);
} else {
  console.log("[refresh] _encryption unchanged");
}

writeFileSync(ACCOUNTS_FILE, JSON.stringify(all, null, 2) + "\n");
console.log(`[refresh] accounts saved: ${accountName}`);
console.log(`[refresh] ds_user_id=${all[accountName].ds_user_id}  sessionid=${(finalCookies.sessionid || "").slice(0, 30)}...`);
