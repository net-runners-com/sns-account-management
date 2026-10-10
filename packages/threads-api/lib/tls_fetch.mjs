// TLS フィンガープリント模倣 fetch (Tier 2)
//
// tlsclientwrapper (bogdanfinn/tls-client の Node ラッパ) を使って Chrome 146 の
// JA3/JA4 + HTTP/2 SETTINGS フレーム順序を模倣する.
//
// API: tlsFetch(url, init) — fetch と互換シグネチャ. lib/fingerprint.mjs の
// httpFetch をこちらに差し替えるだけで全コードが TLS 模倣を経由するようになる.
import tlsclient from "tlsclientwrapper";
const { ModuleClient, SessionClient } = tlsclient.default ?? tlsclient;

let _module = null;
let _session = null;
let _initPromise = null;

async function ensureSession() {
  if (_session) return _session;
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    _module = new ModuleClient({ maxThreads: 2 });
    await _module.open();  // 初回は Go binary を ~/.cache 等にダウンロード
    _session = new SessionClient(_module, {
      tlsClientIdentifier: "chrome_146",
      followRedirects: false,
      withRandomTLSExtensionOrder: true,
      withoutCookieJar: true,  // cookie 管理は呼び出し側でする
      timeoutSeconds: 30,
      catchPanics: true,
    });
    return _session;
  })();
  return _initPromise;
}

export async function shutdownTls() {
  if (_session) {
    try { await _session.destroyAll(); } catch {}
    _session = null;
  }
  if (_module) {
    try { await _module.terminate(); } catch {}
    _module = null;
  }
  _initPromise = null;
}

// tls-client レスポンスを fetch Response 互換にラップ
function wrapResponse(tlsRes) {
  // Set-Cookie の取得: withoutCookieJar=true だと tlsRes.cookies は空になるため
  // headers["Set-Cookie"] (配列 or 文字列) を優先して使う
  const setCookies = [];
  for (const [k, v] of Object.entries(tlsRes.headers || {})) {
    if (k.toLowerCase() !== "set-cookie") continue;
    if (Array.isArray(v)) setCookies.push(...v);
    else if (typeof v === "string") setCookies.push(v);
  }
  // フォールバック: cookies フィールドがあれば再構築 (cookieJar 有効時)
  if (setCookies.length === 0 && tlsRes.cookies) {
    for (const [name, c] of Object.entries(tlsRes.cookies)) {
      let s = `${name}=${c?.value ?? ""}`;
      if (c?.domain) s += `; Domain=${c.domain}`;
      if (c?.path) s += `; Path=${c.path}`;
      if (c?.expires) s += `; Expires=${c.expires}`;
      if (c?.maxAge !== undefined && c?.maxAge !== null) s += `; Max-Age=${c.maxAge}`;
      if (c?.httpOnly) s += `; HttpOnly`;
      if (c?.secure) s += `; Secure`;
      if (c?.sameSite) s += `; SameSite=${c.sameSite}`;
      setCookies.push(s);
    }
  }

  const headers = {
    get(name) {
      const lower = String(name).toLowerCase();
      if (lower === "set-cookie") return setCookies.join(", ");
      // tls-client のヘッダは Record<string, string|string[]>. 大文字小文字区別なし検索
      for (const [k, v] of Object.entries(tlsRes.headers || {})) {
        if (k.toLowerCase() === lower) {
          return Array.isArray(v) ? v.join(", ") : v;
        }
      }
      return null;
    },
    getSetCookie() {
      return setCookies;
    },
  };

  const body = tlsRes.body || "";
  const responseLike = {
    status: tlsRes.status,
    ok: tlsRes.status >= 200 && tlsRes.status < 300,
    headers,
    text: async () => body,
    json: async () => JSON.parse(body),
    clone() { return wrapResponse(tlsRes); },
    _tlsRes: tlsRes,
  };
  return responseLike;
}

export async function tlsFetch(url, init = {}) {
  const session = await ensureSession();
  const method = (init.method || "GET").toUpperCase();
  const headers = { ...(init.headers || {}) };

  const opts = {
    headers,
    // 個別リクエストでも cookie jar 無効化（呼び出し側が Cookie ヘッダを付ける）
    withoutCookieJar: true,
  };
  if (init.redirect === "manual") opts.followRedirects = false;
  if (init.redirect === "follow") opts.followRedirects = true;

  let tlsRes;
  if (method === "GET") tlsRes = await session.get(url, opts);
  else if (method === "HEAD") tlsRes = await session.head(url, opts);
  else if (method === "DELETE") tlsRes = await session.delete(url, opts);
  else if (method === "OPTIONS") tlsRes = await session.options(url, opts);
  else {
    // POST / PUT / PATCH
    const body = init.body ?? "";
    const fn = method.toLowerCase();
    tlsRes = await session[fn](url, body, opts);
  }
  return wrapResponse(tlsRes);
}
