// Threads ユーザー情報取得 (interop_messaging_user_fbid 含む)
//
// 用途: dm.mjs --to-fbid に渡す interop_messaging_user_fbid を取得する.
//
// 仕組み:
//   1. accounts/threads_accounts.json から動作中の Threads-issued mobile_bearer を取得
//   2. https://i.instagram.com/api/v1/users/{pk}/info/ を Bearer + X-IG-App-ID=Threads で叩く
//   3. response.user.interop_messaging_user_fbid を抽出
//
// 注意:
//   - instagrapi の user_info_by_username は interop_messaging_user_fbid を返さない (extractor が拾わない)
//   - 直接 IG mobile API を叩く必要がある
//   - IG pk と Threads pk は別物. 自分自身の pk で 404 になることがあるので両方 fallback で試す
//   - Bearer は IG-issued ではなく Threads-issued でないと一部フィールドが落ちる
import { readFileSync } from "fs";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { ACCOUNTS_FILE } from "../session.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BRIDGE_PY = resolve(__dirname, "../instagrapi-bridge/.venv/bin/python");
const BRIDGE_SCRIPT = resolve(__dirname, "../instagrapi-bridge/bridge.py");

// User-Agent / App-ID は env で上書き可能 (THREADS_BARCELONA_UA / THREADS_APP_ID)
// 既定は dms.mjs と同じ AVD-flavor UA. 数週おきに rotate される可能性あり.
const BARCELONA_UA = process.env.THREADS_BARCELONA_UA
  || "Barcelona 426.0.0.36.67 Android (34/14; 420dpi; 1080x2400; Google/google; sdk_gphone64_arm64; emu64a; ranchu; en_US; 947514750)";
const THREADS_APP_ID = process.env.THREADS_APP_ID || "238260118697367";

/** 動作する Threads-issued Bearer を accounts.json から拾う (preferred → 任意 fallback). */
function pickBearer(preferredAccount) {
  const all = JSON.parse(readFileSync(ACCOUNTS_FILE, "utf8"));
  const order = [];
  if (preferredAccount && all[preferredAccount]?.mobile_bearer) order.push(preferredAccount);
  for (const k of Object.keys(all)) {
    if (k.startsWith("_") || order.includes(k)) continue;
    if (all[k]?.mobile_bearer) order.push(k);
  }
  for (const name of order) {
    const acc = all[name];
    return { bearer: acc.mobile_bearer, account: name };
  }
  throw new Error("no mobile_bearer found in any account (run dm.mjs once with credentials to populate)");
}

async function fetchUserInfo(userId, bearer) {
  const url = `https://i.instagram.com/api/v1/users/${encodeURIComponent(userId)}/info/?is_prefetch=false&entry_point=profile&from_module=feed_timeline`;
  const r = await fetch(url, {
    headers: {
      Authorization: bearer,
      "User-Agent": BARCELONA_UA,
      "X-IG-App-ID": THREADS_APP_ID,
    },
  });
  if (r.status !== 200) return null;
  const j = await r.json().catch(() => ({}));
  return j.user || null;
}

// "None" 文字列も null 扱い (instagrapi の Python None が "None" として stringify されることあり)
const N = (v) => (v == null || v === "None" || v === "" ? null : v);

// IG mobile API / instagrapi user オブジェクトから整形 summary を抽出
function summarize(u) {
  if (!u) return null;
  const isBusiness = !!u.is_business || u.account_type === 3;
  const isCreator = !!u.is_creator_account || u.account_type === 2;
  // account_type 値が null でも is_business/is_creator から推定
  const inferredType = u.account_type ?? (isBusiness ? 3 : (isCreator ? 2 : 1));
  const label = ({ 1: "Personal", 2: "Creator", 3: "Business", 4: "Other" })[inferredType] ?? "Personal";

  const out = {
    pk: String(u.pk),
    username: u.username,
    full_name: N(u.full_name) || "",
    interop_messaging_user_fbid: N(u.interop_messaging_user_fbid),
    fbid_v2: N(u.fbid_v2),
    is_private: !!u.is_private,
    is_verified: !!u.is_verified,
    is_business: isBusiness,
    is_creator: isCreator,
    account_type: u.account_type ?? null,
    account_type_label: label,
    // Threads 利用判定: 複数フィールドで確認
    has_threads: !!u.is_active_on_text_post_app
      || !!u.has_onboarded_to_text_post_app
      || (u.media_count ?? 0) > 0   // 投稿あれば Threads 使ってる
      || u.text_post_app_is_private !== undefined,
    biography: N(u.biography),
    external_url: N(u.external_url),
    follower_count: u.follower_count ?? null,
    following_count: u.following_count ?? null,
    media_count: u.media_count ?? null,
    profile_pic_url: u.profile_pic_url_hd || u.profile_pic_url || null,
  };
  // ビジネス / クリエイターの公開連絡先
  const cat = N(u.category_name) || N(u.business_category_name);
  const email = N(u.public_email);
  const phone = u.public_phone_country_code && u.public_phone_number
    ? `+${u.public_phone_country_code}${u.public_phone_number}` : null;
  const addr = N(u.address_street) || N(u.city_name);
  if (isBusiness || cat || email || addr) {
    out.business = {
      category_name: cat,
      contact_method: N(u.business_contact_method),
      public_email: email,
      public_phone: phone,
      address: {
        street: N(u.address_street),
        city: N(u.city_name),
        zip: N(u.zip),
        location_id: N(u.instagram_location_id),
        lat: u.latitude ?? null,
        lng: u.longitude ?? null,
      },
    };
  }
  return out;
}

/**
 * 指定 user_id の interop_messaging_user_fbid を取得.
 *
 * @param {object} opts
 * @param {string|number} opts.userId    - Threads pk または IG pk (どちらか. 両方試す場合は getInteropFbidMulti)
 * @param {string} [opts.viaAccount]     - Bearer に使うアカウント名 (default: 動作中の任意)
 * @returns {Promise<null | {pk, username, full_name, interop_messaging_user_fbid, fbid_v2, raw}>}
 */
export async function getInteropFbid({ userId, viaAccount } = {}) {
  if (!userId) throw new Error("userId required");
  const { bearer } = pickBearer(viaAccount);
  const u = await fetchUserInfo(String(userId), bearer);
  if (!u) return null;
  return { ...summarize(u), raw: u };
}

/**
 * 複数の id 候補を順に試して interop fbid を返す (404 fallback 用).
 *
 * @param {object} opts
 * @param {string[]} opts.candidates - 試す user_id 配列 (Threads pk, IG pk 等)
 * @param {string} [opts.viaAccount]
 */
export async function getInteropFbidMulti({ candidates, viaAccount } = {}) {
  if (!candidates?.length) throw new Error("candidates required");
  const { bearer, account } = pickBearer(viaAccount);
  // 最初に成功した user object を保存しておき、interop が取れなくても summary を返す
  let lastU = null;
  for (const id of candidates) {
    const u = await fetchUserInfo(String(id), bearer);
    if (!u) continue;
    lastU = u;
    if (u.interop_messaging_user_fbid) {
      return { ...summarize(u), via_bearer_account: account, raw: u };
    }
  }
  // interop_messaging_user_fbid 取れなかったが user info は取れた場合 summary だけ返す
  if (lastU) return { ...summarize(lastU), via_bearer_account: account, raw: lastU };
  return null;
}

/**
 * username → instagrapi で IG pk 取得 → IG pk + Threads pk (accounts.json にあれば) で interop 取得.
 *
 * @param {object} opts
 * @param {string} opts.username     - 対象 username (@ 不要)
 * @param {string} [opts.viaAccount] - Bearer / instagrapi に使うアカウント
 */
export async function getInteropFbidByUsername({ username, viaAccount } = {}) {
  if (!username) throw new Error("username required");
  const cleanName = username.replace(/^@/, "").toLowerCase();

  // candidate 1: accounts.json に Threads pk が登録されてれば使う (ds_user_id / mobile_user_id 両方)
  const all = JSON.parse(readFileSync(ACCOUNTS_FILE, "utf8"));
  const candidates = [];
  for (const k of Object.keys(all)) {
    if (k.startsWith("_")) continue;
    if (String(all[k].username || "").toLowerCase() !== cleanName) continue;
    for (const id of [all[k].ds_user_id, all[k].mobile_user_id]) {
      if (id && !candidates.includes(String(id))) candidates.push(String(id));
    }
  }

  // candidate 2: instagrapi で IG pk 取得 (bridge アカウントが取れる場合のみ)
  // 同時に instagrapi 結果を IG-mobile-API fallback として使う (interop fbid 取れなくても profile 情報返す)
  const bridgeAcc = viaAccount || process.env.INSTAGRAPI_ACCOUNT || process.env.THREADS_ACCOUNT;
  let instagrapiUser = null;
  if (bridgeAcc) {
    const env = {
      ...process.env,
      INSTAGRAPI_ACCOUNT: bridgeAcc,
      INSTAGRAPI_USERNAME: process.env.THREADS_USERNAME || "x",
      INSTAGRAPI_PASSWORD: process.env.THREADS_PASSWORD || "x",
    };
    const r = spawnSync(BRIDGE_PY, [BRIDGE_SCRIPT, "user-info", cleanName], { env, encoding: "utf8" });
    if (r.status === 0) {
      try {
        const u = JSON.parse(r.stdout.trim());
        instagrapiUser = u;
        if (u.pk && !candidates.includes(String(u.pk))) candidates.push(String(u.pk));
      } catch {}
    }
  }

  if (!candidates.length) throw new Error(`username "${cleanName}" → cannot resolve any user_id`);

  const r = await getInteropFbidMulti({ candidates, viaAccount });
  if (r) return r;

  // IG mobile API で全 candidate 404 → instagrapi 結果を summary に変換して返す
  if (instagrapiUser) return { ...summarize(instagrapiUser), via_bearer_account: null, raw: instagrapiUser, _source: "instagrapi" };
  return null;
}
