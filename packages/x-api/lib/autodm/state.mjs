// autodm の状態ファイルと jsonl ログ.
//   data/<account>/autodm_state.json  … sent / pending / failed / expired / daily / me
//   data/<account>/autodm_log.jsonl   … 1行1イベント
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, appendFileSync } from "fs";
import { dirname, join } from "path";
import { DEFAULT_DATA_DIR } from "../save.mjs";

export function statePath(accountName, dir = DEFAULT_DATA_DIR) {
  return join(dir, accountName, "autodm_state.json");
}
export function logPath(accountName, dir = DEFAULT_DATA_DIR) {
  return join(dir, accountName, "autodm_log.jsonl");
}

export function emptyState() {
  return { sent: {}, pending: {}, failed: {}, expired: {}, daily: {}, me: null };
}

export function loadState(path) {
  if (!existsSync(path)) return emptyState();
  return { ...emptyState(), ...JSON.parse(readFileSync(path, "utf8")) };
}

/** tmp → rename でアトミックに書く */
export function saveState(path, state) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, path);
}

export function candidateKey(postId, userId) {
  return `${postId}:${userId}`;
}

/** ローカル日付 YYYY-MM-DD */
export function dayKey(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
export function dailyCount(state, now = new Date()) {
  return state.daily[dayKey(now)] || 0;
}
export function bumpDaily(state, now = new Date()) {
  const k = dayKey(now);
  state.daily[k] = (state.daily[k] || 0) + 1;
}

/** pendingDays を超えた pending を expired に移し、移したキーを返す */
export function expirePending(state, pendingDays, now = new Date()) {
  const cutoff = now.getTime() - pendingDays * 86400000;
  const moved = [];
  for (const [key, p] of Object.entries(state.pending)) {
    if (new Date(p.first_seen).getTime() < cutoff) {
      state.expired[key] = { at: now.toISOString(), screen_name: p.screen_name, trigger: p.trigger };
      delete state.pending[key];
      moved.push(key);
    }
  }
  return moved;
}

export function appendLog(path, event) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n");
}
