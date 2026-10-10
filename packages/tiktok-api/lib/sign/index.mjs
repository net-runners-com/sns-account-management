// TikTok web リクエスト署名ラッパー
// X-Bogus + X-Gnarly を付けた signed URL を返す.
import signBogus from "./xbogus.mjs";
import signGnarly from "./xgnarly.mjs";

const DEFAULT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";

/**
 * @param {object} opts
 * @param {string} opts.url   ベース URL (https://www.tiktok.com/api/...)
 * @param {object} opts.params クエリパラメータ
 * @param {object} [opts.body] POST body (JSON 化される)
 * @param {string} [opts.userAgent]
 * @returns {{ signedUrl: string, body: string, userAgent: string, xBogus: string, xGnarly: string }}
 */
export function signParams({ url, params, body, userAgent = DEFAULT_UA }) {
  const queryString = new URLSearchParams(params).toString();
  const bodyStr = body ? JSON.stringify(body) : "";
  const ts = Math.floor(Date.now() / 1000);
  const xBogus = signBogus(queryString, bodyStr, userAgent, ts);
  const xGnarly = signGnarly(queryString, bodyStr, userAgent, 0, "5.1.1");
  return {
    signedUrl: `${url}?${queryString}&X-Bogus=${xBogus}&X-Gnarly=${encodeURIComponent(xGnarly)}`,
    body: bodyStr,
    userAgent,
    xBogus,
    xGnarly,
  };
}
