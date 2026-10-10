// セッション有効性チェック: 認証必須APIを叩いて200か401かで判定
//
// 使い方:
//   node check_session.mjs                              → personal_dev を確認
//   node check_session.mjs hirotodev0622                → 指定アカウント確認
//   node --env-file=.env check_session.mjs personal_dev --auto-refresh
//                                                       → 切れてたら再ログインして更新
//
// exit code:
//   0  セッション有効
//   1  セッション切れ (cookie expired / unauthorized)
//   2  その他エラー (ネットワーク, アカウント未登録 等)
import { getClientAs } from "./session.mjs";
import { getStatsPv } from "./lib/index.mjs";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const autoRefresh = args.includes("--auto-refresh");
const accountName = args.find(a => !a.startsWith("--")) || "personal_dev";

function classifyError(err, body) {
  const msg = `${err?.message || ""} ${err?.status || ""} ${typeof body === "string" ? body : JSON.stringify(body || "")}`.toLowerCase();
  if (msg.includes("401") || msg.includes("unauthorized") || msg.includes("login_required") || msg.includes("not_signed_in") || msg.includes("forbidden") || msg.includes("403")) {
    return "expired";
  }
  return "other";
}

async function checkOnce() {
  const client = await getClientAs(accountName);
  try {
    const r = await getStatsPv(client, { filter: "all", page: 1, sort: "pv" });
    // 認証OKなら data.total_pv 等が必ず入る
    if (r?.data?.note_stats !== undefined || typeof r?.data?.total_pv === "number") {
      return { status: "alive", total_pv: r.data.total_pv, notes: r.data.note_stats?.length };
    }
    // data なし or error フィールド付き → 期限切れ扱い
    return { status: "expired", body: r };
  } catch (e) {
    const kind = classifyError(e, e?.body);
    return { status: kind, error: e?.message || String(e) };
  }
}

let result = await checkOnce();

if (result.status === "alive") {
  console.log(`OK: session alive (${accountName}) — total_pv=${result.total_pv} notes=${result.notes}`);
  process.exit(0);
}

if (result.status === "expired") {
  console.error(`EXPIRED: session dead for "${accountName}"`);
  if (result.error) console.error(`  reason: ${result.error}`);
  if (result.body) console.error(`  body: ${JSON.stringify(result.body).slice(0, 200)}`);

  if (!autoRefresh) {
    console.error(`hint: re-run with --auto-refresh (and --env-file=.env) to auto re-login`);
    process.exit(1);
  }

  // 自動リフレッシュ: refresh_session.mjs を子プロセスで起動
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

  // 再検証
  console.error(`[check] re-verifying...`);
  result = await checkOnce();
  if (result.status === "alive") {
    console.log(`OK: session refreshed and alive (${accountName}) — total_pv=${result.total_pv} notes=${result.notes}`);
    process.exit(0);
  }
  console.error(`STILL DEAD after refresh: ${JSON.stringify(result).slice(0, 200)}`);
  process.exit(1);
}

console.error(`ERROR: ${result.error || "unknown"}`);
process.exit(2);
