// キーワード照合. NFKC 正規化 → 小文字 → 空白除去 してから部分一致.
export function normalizeText(s) {
  return String(s ?? "").normalize("NFKC").toLowerCase().replace(/\s+/g, "");
}

/**
 * @returns {string|null} 一致した元のキーワード. 無ければ null.
 */
export function matchKeyword(text, keywords) {
  const t = normalizeText(text);
  for (const k of keywords || []) {
    const nk = normalizeText(k);
    if (nk && t.includes(nk)) return k;
  }
  return null;
}
