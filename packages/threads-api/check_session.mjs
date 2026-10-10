// Threads セッション有効性チェック: 認証必須エンドポイントを叩いて生死判定
//
// 使い方:
//   node check_session.mjs <accountName>
//   node --env-file=.env check_session.mjs <accountName> --auto-refresh
//                                            → 切れてたら refresh_session を子プロセスで起動
//
// account は positional arg or env THREADS_ACCOUNT.
//
// exit code:
//   0  alive
//   1  expired
//   2  other (network / unregistered account 等)
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { getAccount } from "./session.mjs";
import { authedJsonHeaders } from "./lib/http.mjs";
import { httpFetch } from "./lib/fingerprint.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const autoRefresh = args.includes("--auto-refresh");
const accountName = args.find(a => !a.startsWith("--")) || process.env.THREADS_ACCOUNT;
if (!accountName) {
  console.error("ERROR: account name (positional arg) または env THREADS_ACCOUNT が必要");
  process.exit(2);
}

async function checkOnce() {
  let acc;
  try {
    acc = getAccount(accountName);
  } catch (e) {
    return { status: "other", error: e.message };
  }
  if (!acc.cookies || !acc.ds_user_id) {
    return { status: "expired", error: "cookies or ds_user_id missing" };
  }

  const url = `https://www.threads.com/api/v1/users/${acc.ds_user_id}/info/`;
  let res, text;
  try {
    res = await httpFetch(url, {
      headers: authedJsonHeaders({ csrftoken: acc.csrftoken, cookie: acc.cookies }),
      redirect: "manual",
    });
    text = await res.text();
  } catch (e) {
    return { status: "other", error: `fetch failed: ${e?.message || e}` };
  }

  // パターン分け
  // 200 + JSON: { user: {...} } → alive
  // 200 + JSON: { message: "login_required", status: "fail" } → expired
  // 401/403 → expired
  // 302 → expired (login へリダイレクト)
  if (res.status === 401 || res.status === 403) {
    return { status: "expired", http: res.status, body: text.slice(0, 200) };
  }
  if (res.status >= 300 && res.status < 400) {
    return { status: "expired", http: res.status, redirect: res.headers.get("location") };
  }
  let json;
  try { json = JSON.parse(text); } catch { json = null; }
  if (!json) {
    return { status: "other", error: `non-json HTTP ${res.status}`, body: text.slice(0, 200) };
  }
  if (json.message === "login_required" || json.require_login || json.status === "fail") {
    return { status: "expired", body: json };
  }
  if (json.user && (json.user.pk || json.user.id || json.user.username)) {
    return {
      status: "alive",
      username: json.user.username,
      full_name: json.user.full_name,
      follower_count: json.user.follower_count,
    };
  }
  // それ以外 → 形式不明
  return { status: "other", error: "unexpected response shape", body: JSON.stringify(json).slice(0, 200) };
}

let result = await checkOnce();

if (result.status === "alive") {
  console.log(`OK: session alive (${accountName}) — @${result.username}  followers=${result.follower_count ?? "?"}`);
  process.exit(0);
}

if (result.status === "expired") {
  console.error(`EXPIRED: session dead for "${accountName}"`);
  if (result.error) console.error(`  reason: ${result.error}`);
  if (result.http) console.error(`  http: ${result.http}`);
  if (result.body) console.error(`  body: ${typeof result.body === "string" ? result.body : JSON.stringify(result.body).slice(0, 200)}`);

  if (!autoRefresh) {
    console.error(`hint: re-run with --env-file=.env --auto-refresh to auto re-login`);
    process.exit(1);
  }

  console.error(`[check] auto-refreshing...`);
  const refreshScript = resolve(__dirname, "refresh_session.mjs");
  const proc = spawnSync(process.execPath, [refreshScript, accountName], {
    stdio: "inherit",
    env: process.env,
  });
  if (proc.status !== 0) {
    console.error(`[check] refresh failed (exit ${proc.status})`);
    process.exit(1);
  }
  console.error(`[check] re-verifying...`);
  result = await checkOnce();
  if (result.status === "alive") {
    console.log(`OK: session refreshed and alive (${accountName}) — @${result.username}`);
    process.exit(0);
  }
  console.error(`STILL DEAD after refresh: ${JSON.stringify(result).slice(0, 200)}`);
  process.exit(1);
}

console.error(`ERROR: ${result.error || "unknown"}`);
if (result.body) console.error(`  body: ${typeof result.body === "string" ? result.body : JSON.stringify(result.body).slice(0, 200)}`);
process.exit(2);
