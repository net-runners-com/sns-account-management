// 対象ユーザーのプロフィール取得 (instagrapi-bridge 経由)
//
// 公開情報のみ取得可能:
//   個人:  username, full_name, biography, follower/following count, profile_pic_url, etc.
//   business: 上記 + address_street / city / zip / lat-lng / public_email / public_phone
//
// 認証は send 不要なので Threads モードどちらでもOK
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BRIDGE_PY = resolve(__dirname, "../instagrapi-bridge/.venv/bin/python");
const BRIDGE_SCRIPT = resolve(__dirname, "../instagrapi-bridge/bridge.py");

function callBridge(args, env = {}) {
  const r = spawnSync(BRIDGE_PY, [BRIDGE_SCRIPT, ...args], {
    env: { ...process.env, ...env },
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (r.status !== 0) {
    throw new Error(`bridge exit ${r.status}\nstderr: ${r.stderr?.slice(0, 500)}\nstdout: ${r.stdout?.slice(0, 200)}`);
  }
  try {
    return JSON.parse(r.stdout.trim());
  } catch (e) {
    throw new Error(`non-JSON output: ${r.stdout.slice(0, 300)}`);
  }
}

/**
 * username から user info を取得
 * @param {object} opts
 * @param {string} opts.username   対象ユーザー名 (@マーク不要)
 * @param {string} [opts.account]  使う bridge アカウント (env THREADS_ACCOUNT / INSTAGRAPI_ACCOUNT で代替可)
 * @param {boolean} [opts.threadsMode] true で Threads モード login
 */
export async function getProfile({ username, account, threadsMode = true } = {}) {
  if (!username) throw new Error("username required");
  const cleanUsername = String(username).replace(/^@/, "");
  const resolved = account || process.env.INSTAGRAPI_ACCOUNT || process.env.THREADS_ACCOUNT;
  if (!resolved) throw new Error("account required (pass account opt, or set INSTAGRAPI_ACCOUNT / THREADS_ACCOUNT env)");
  return callBridge(["user-info", cleanUsername], {
    INSTAGRAPI_ACCOUNT: resolved,
    INSTAGRAPI_USERNAME: process.env.THREADS_USERNAME,
    INSTAGRAPI_PASSWORD: process.env.THREADS_PASSWORD,
    ...(threadsMode ? { INSTAGRAPI_THREADS_MODE: "1" } : {}),
  });
}

/**
 * プロフィール data を整形して読みやすく
 */
export function summarizeProfile(p) {
  const out = {
    username: p.username,
    full_name: p.full_name,
    pk: p.pk,
    is_private: p.is_private,
    is_verified: p.is_verified,
    is_business: p.is_business,
    account_type: p.account_type,
    biography: p.biography,
    external_url: p.external_url,
    counts: {
      followers: p.follower_count,
      following: p.following_count,
      posts: p.media_count,
    },
    profile_pic_url: p.profile_pic_url_hd || p.profile_pic_url,
    interop_messaging_user_fbid: p.interop_messaging_user_fbid,
  };

  // business の場合の連絡先 / 住所
  if (p.is_business || p.public_email || p.address_street) {
    out.business = {
      category_name: p.category_name || p.business_category_name,
      contact_method: p.business_contact_method,
      public_email: p.public_email,
      public_phone: p.public_phone_country_code && p.public_phone_number
        ? `+${p.public_phone_country_code}${p.public_phone_number}`
        : null,
      address: {
        street: p.address_street,
        city: p.city_name,
        zip: p.zip,
        location_id: p.instagram_location_id,
        lat: p.latitude,
        lng: p.longitude,
      },
    };
  }
  return out;
}
