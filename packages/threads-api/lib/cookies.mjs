// Cookie ヘルパ: Set-Cookie パースとシリアライズ

export function parseSetCookies(setCookieList = []) {
  const out = {};
  for (const sc of setCookieList) {
    const head = sc.split(";")[0] ?? "";
    const eq = head.indexOf("=");
    if (eq < 0) continue;
    const name = head.slice(0, eq).trim();
    const value = head.slice(eq + 1).trim();
    if (!name) continue;
    if (value === "deleted" || value === '""') continue;
    out[name] = value;
  }
  return out;
}

export function mergeCookies(...sources) {
  const merged = {};
  for (const src of sources) {
    if (!src) continue;
    for (const [k, v] of Object.entries(src)) {
      if (v === undefined || v === null || v === "") continue;
      merged[k] = v;
    }
  }
  return merged;
}

export function serializeCookies(map) {
  return Object.entries(map)
    .filter(([_, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

export function parseCookieHeader(cookieStr = "") {
  const out = {};
  for (const part of cookieStr.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

export function getSetCookieList(headers) {
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  // fallback: split on commas (危険だが Node18- 互換)
  const raw = headers.get("set-cookie");
  return raw ? raw.split(/,(?=[^ ]+=)/g) : [];
}
