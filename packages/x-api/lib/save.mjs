// 取得データの自動保存ヘルパー.
//
// デフォルト保存先: <package>/data/<account>/<task>_<context>_<timestamp>.json
// 環境変数 X_DATA_PATH で data ルート上書き可能.
// CLI で --no-save 指定された時はスキップ.

import { writeFileSync, mkdirSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const DEFAULT_DATA_DIR = process.env.X_DATA_PATH
  ? resolve(process.env.X_DATA_PATH)
  : resolve(__dirname, "..", "data");

function sanitize(s, maxLen = 60) {
  if (!s) return "";
  return String(s)
    .replace(/[^A-Za-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLen);
}

function timestamp() {
  // 2026-05-17T00-23-45 形式 (file system 安全)
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

/**
 * データをファイルに保存する.
 * @param {Object} opts
 * @param {string} opts.account     アカウント名 (保存先 subdir)
 * @param {string} opts.task        タスク名 (例: "posts", "profile", "search", "follows")
 * @param {string} [opts.context]   文脈識別子 (例: screen-name, query, user-id). filename に組み込まれる
 * @param {any}    opts.data        保存する JSON シリアライズ可能な値
 * @param {string} [opts.dir]       data ルート上書き (デフォルト: DEFAULT_DATA_DIR)
 * @param {string} [opts.suffix]    追加 suffix (例: "raw"). filename の task と context の間に挟まる
 * @returns {string}                保存したフルパス
 */
export function saveData({ account, task, context, data, dir, suffix }) {
  if (!task) throw new Error("saveData: task is required");
  const root = dir ? resolve(dir) : DEFAULT_DATA_DIR;
  const acctDir = join(root, sanitize(account || "_default", 40));
  mkdirSync(acctDir, { recursive: true });
  const parts = [sanitize(task, 30)];
  if (suffix) parts.push(sanitize(suffix, 20));
  if (context) parts.push(sanitize(context, 60));
  parts.push(timestamp());
  const filename = parts.join("_") + ".json";
  const fullpath = join(acctDir, filename);
  writeFileSync(fullpath, JSON.stringify(data, null, 2));
  return fullpath;
}

/**
 * CLI 共通の保存オプションパーサ.
 * argv から --no-save / --save-dir を抜き出して残りの argv と一緒に返す.
 * @param {string[]} argv
 * @returns {{ noSave: boolean, saveDir: string|null, remaining: string[] }}
 */
export function parseSaveFlags(argv) {
  let noSave = false;
  let saveDir = null;
  const remaining = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--no-save") { noSave = true; continue; }
    if (a === "--save-dir") { saveDir = argv[++i]; continue; }
    remaining.push(a);
  }
  return { noSave, saveDir, remaining };
}
