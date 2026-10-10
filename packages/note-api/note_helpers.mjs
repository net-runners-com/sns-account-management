// 旧ヘルパーの互換窓口 (非推奨)
// 新規コードは lib/index.mjs を直接 import してください。
// 既存の test_*.mjs が動くようにするためのシム。

export * from "./lib/index.mjs";

// 旧名のエイリアス
import { saveDraft } from "./lib/notes.mjs";
export const saveDraftWithEyecatch = saveDraft;
