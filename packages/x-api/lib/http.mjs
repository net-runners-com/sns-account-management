// X 認証リクエスト共通ラッパー
// session 期限切れを自動検出し XSessionError を throw する.
// rebuildHeaders コールバックを渡すと、再ログイン後に新 cookie で 1度自動リトライする.
import { detectSessionError } from "./errors.mjs";
import { reloginAccount, getCredentials } from "./auto_relogin.mjs";

async function _doFetch(url, opts) {
  const r = await fetch(url, opts);
  let json = null;
  let text = null;
  if (!r.ok || r.headers.get("content-type")?.includes("json")) {
    try { json = await r.clone().json(); } catch { try { text = await r.clone().text(); } catch {} }
  }
  if (r.ok && json === null) {
    try { json = await r.clone().json(); } catch { text = text ?? (await r.clone().text()); }
  }
  return { status: r.status, ok: r.ok, json, text, response: r };
}

/**
 * fetch ラッパー: 401/403/X auth code を検出して XSessionError を throw.
 * rebuildHeaders が渡された場合は credentials がある時に限り 1度だけ再ログイン → リトライ.
 *
 * @param {string} url
 * @param {RequestInit} opts
 * @param {object} ctx
 * @param {string} [ctx.accountName]
 * @param {(acc:object) => RequestInit} [ctx.rebuildHeaders] 新 acc を受け取り opts を返すコールバック.
 *   あれば auto_relogin を試みる. 無ければ session error をそのまま throw.
 * @returns {Promise<{status: number, ok: boolean, json: any, text: string|null, response: Response}>}
 */
export async function xFetch(url, opts = {}, { accountName, rebuildHeaders } = {}) {
  let r = await _doFetch(url, opts);
  if (!r.ok) {
    const sessionErr = detectSessionError(r.status, r.json, accountName);
    if (sessionErr) {
      // 自動再ログインしてリトライするか判定
      if (rebuildHeaders && accountName) {
        const { username, password } = getCredentials(accountName);
        if (username && password) {
          try {
            const newAcc = await reloginAccount(accountName);
            const newOpts = rebuildHeaders(newAcc);
            r = await _doFetch(url, newOpts);
            if (!r.ok) {
              const err2 = detectSessionError(r.status, r.json, accountName);
              if (err2) throw err2;
            }
            return r;
          } catch (e) {
            console.error(`[xFetch] 再ログイン失敗: ${e.message}`);
            throw sessionErr;
          }
        }
      }
      throw sessionErr;
    }
  }
  return r;
}
