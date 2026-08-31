// autodm 設定 (autodm/<account>.json) の読込・デフォルト・クランプ・検証.
import { readFileSync, readdirSync, existsSync } from "fs";
import { resolve, dirname, join, basename } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_CONFIG_DIR = resolve(__dirname, "..", "..", "autodm");

export const DEFAULTS = {
  daily_cap: 50,
  poll_interval_sec: 600,
  pending_days: 7,
  dm_delay_sec: [30, 90],
  search_max_pages: 3,
};
export const MIN_POLL_INTERVAL_SEC = 300;
export const MAX_DAILY_CAP = 500;

export function normalizeConfig(raw) {
  const c = { ...DEFAULTS, ...(raw || {}) };
  c.poll_interval_sec = Math.max(MIN_POLL_INTERVAL_SEC, Number(c.poll_interval_sec) || DEFAULTS.poll_interval_sec);
  c.daily_cap = Math.min(MAX_DAILY_CAP, Math.max(0, Number(c.daily_cap) || 0));
  c.pending_days = Math.max(0, Number(c.pending_days) || DEFAULTS.pending_days);
  if (
    !Array.isArray(c.dm_delay_sec) || c.dm_delay_sec.length !== 2 ||
    !c.dm_delay_sec.every((n) => Number.isFinite(Number(n)) && Number(n) >= 0) ||
    Number(c.dm_delay_sec[0]) > Number(c.dm_delay_sec[1])
  ) {
    c.dm_delay_sec = [...DEFAULTS.dm_delay_sec];
  } else {
    c.dm_delay_sec = c.dm_delay_sec.map(Number);
  }
  c.search_max_pages = Math.max(1, Number(c.search_max_pages) || DEFAULTS.search_max_pages);
  if (!Array.isArray(c.triggers)) throw new Error("config.triggers must be an array");
  c.triggers = c.triggers.map((t, i) => {
    if (t.post_id === undefined || t.post_id === null || t.post_id === "") throw new Error(`triggers[${i}].post_id required`);
    if (!Array.isArray(t.keywords) || t.keywords.length === 0) throw new Error(`triggers[${i}].keywords must be a non-empty array`);
    if (!t.dm_text) throw new Error(`triggers[${i}].dm_text required`);
    return {
      id: t.id || `trigger-${i}`,
      post_id: String(t.post_id),
      keywords: t.keywords.map(String),
      dm_text: String(t.dm_text),
      active: t.active !== false,
    };
  });
  return c;
}

export function configPath(accountName, dir = DEFAULT_CONFIG_DIR) {
  return join(dir, `${accountName}.json`);
}

export function loadConfig(path) {
  if (!existsSync(path)) throw new Error(`autodm config not found: ${path}`);
  return normalizeConfig(JSON.parse(readFileSync(path, "utf8")));
}

export function listConfigAccounts(dir = DEFAULT_CONFIG_DIR) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json") && f !== "example.json")
    .map((f) => basename(f, ".json"))
    .sort();
}
