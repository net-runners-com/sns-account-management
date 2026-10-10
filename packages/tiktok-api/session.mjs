// TikTok アカウントセッション管理
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ACCOUNTS_FILE = resolve(__dirname, "../../accounts/tiktok_accounts.json");

export const TIKTOK_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";

export function loadAccounts() {
  if (!existsSync(ACCOUNTS_FILE)) return {};
  return JSON.parse(readFileSync(ACCOUNTS_FILE, "utf8"));
}

export function getAccount(name) {
  const all = loadAccounts();
  const acc = all[name];
  if (!acc) throw new Error(`TikTok account not found: ${name}`);
  return acc;
}

export function saveAccount(name, patch) {
  const all = loadAccounts();
  all[name] = { ...(all[name] || {}), ...patch };
  writeFileSync(ACCOUNTS_FILE, JSON.stringify(all, null, 2));
}

// odin_tt (32 chars) → device_id (19 桁数字) を抽出する.
// odin_tt は「device_id を含むハッシュトークン」だが、別途 device_id 直接保存がベター.
// fallback: ttwid に埋め込まれてる ts ベースの ID 風 random 値を使う.
export function getDeviceId(acc) {
  if (acc.device_id) return acc.device_id;
  // 19 桁の TikTok device_id 形式を擬似生成 (cookie 分離維持のため固定値)
  return "7637873442330986004";
}

// web リクエスト共通ヘッダ (cookie + UA + Referer 等)
export function browserHeaders(acc, { referer = "https://www.tiktok.com/" } = {}) {
  return {
    Cookie: acc.cookies || "",
    "User-Agent": TIKTOK_UA,
    Accept: "*/*",
    "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
    Referer: referer,
    Origin: "https://www.tiktok.com",
  };
}

// signed-API 用の標準クエリパラメータ (signing 対象に含まれる)
export function baseApiParams(acc) {
  return {
    aid: "1988",
    app_language: "ja-JP",
    app_name: "tiktok_web",
    browser_language: "ja",
    browser_name: "Mozilla",
    browser_online: "true",
    browser_platform: "MacIntel",
    browser_version:
      "5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
    channel: "tiktok_web",
    cookie_enabled: "true",
    device_id: getDeviceId(acc),
    device_platform: "web_pc",
    focus_state: "true",
    history_len: "3",
    is_fullscreen: "false",
    is_page_visible: "true",
    os: "mac",
    priority_region: "JP",
    referer: "",
    region: "JP",
    screen_height: "982",
    screen_width: "1512",
    tz_name: "Asia/Tokyo",
    webcast_language: "ja-JP",
    msToken: acc.msToken || "",
  };
}
