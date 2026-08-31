// X キーワード自動DM
//   node autodm.mjs --account <name> [--dry-run]           1回だけ (既定)
//   node autodm.mjs --all --loop [--interval 600]          autodm/*.json の全アカウントをループ
// 設定: autodm/<account>.json (雛形: autodm/example.json)
// 状態: data/<account>/autodm_state.json / ログ: data/<account>/autodm_log.jsonl
import { runCycle, defaultDeps } from "./lib/autodm/cycle.mjs";
import { listConfigAccounts, loadConfig, configPath, MIN_POLL_INTERVAL_SEC } from "./lib/autodm/config.mjs";

const USAGE = "usage: node autodm.mjs (--account <name> | --all) [--once|--loop] [--dry-run] [--interval <sec>]";
const args = process.argv.slice(2);
let account = null, all = false, loop = false, dryRun = false, interval = null;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--account") account = args[++i];
  else if (a === "--all") all = true;
  else if (a === "--loop") loop = true;
  else if (a === "--once") loop = false;
  else if (a === "--dry-run") dryRun = true;
  else if (a === "--interval") {
    const raw = args[++i];
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 1) { console.error(`invalid --interval: ${raw}\n${USAGE}`); process.exit(1); }
    interval = n;
  }
  else { console.error(`unknown arg: ${a}\n${USAGE}`); process.exit(1); }
}
if (account && all) {
  console.error(`cannot combine --account and --all\n${USAGE}`);
  process.exit(1);
}
const accounts = all ? listConfigAccounts() : account ? [account] : [];
if (accounts.length === 0) {
  console.error(all ? "no configs found in autodm/*.json" : USAGE);
  process.exit(1);
}

const deps = defaultDeps();

async function runAll() {
  for (const name of accounts) {
    try {
      const s = await runCycle({ accountName: name, dryRun, deps });
      console.log(JSON.stringify({ account: name, dryRun, ...s }));
    } catch (e) {
      console.error(`[autodm] ${name} error: ${e.message}`);
    }
  }
}

function nextWaitSec() {
  if (interval) return Math.max(MIN_POLL_INTERVAL_SEC, interval);
  const secs = accounts.map((n) => { try { return loadConfig(configPath(n)).poll_interval_sec; } catch { return MIN_POLL_INTERVAL_SEC; } });
  return Math.max(MIN_POLL_INTERVAL_SEC, Math.min(...secs));
}

do {
  await runAll();
  if (loop) {
    const wait = nextWaitSec();
    console.error(`[autodm] next run in ${wait}s`);
    await new Promise((r) => setTimeout(r, wait * 1000));
  }
} while (loop);
