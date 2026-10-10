// Camoufox (anti-detect Firefox) ラッパー
// TikTok ORCAS bot 検知を bypass するために pure HTTP では無理な経路を browser で解決する.
// 現状は capture-only (search/profile/posts) — 投稿等の write 系は別途.
import { Camoufox } from "camoufox-js";

/**
 * Camoufox ブラウザを起動して context を返す.
 * useCookies=true 時のみ acc.cookies を inject する.
 * 注意: 古い msToken/ttwid を inject すると ORCAS に逆検知されて空 response になる.
 *       原則 guest (cookie skip) で起動し、Camoufox に新規 fresh cookie を取らせる.
 *       ログイン必要な操作 (DM 送信等) では useCookies: true を渡す.
 */
export async function launchCamoufox({ headless = true, acc = null, useCookies = false } = {}) {
  const browser = await Camoufox({
    headless,
    os: "macos",
    locale: ["ja-JP", "ja"],
    geoip: true,
    humanize: true,
    block_webrtc: true,
  });
  const ctx = browser.contexts()[0] || (await browser.newContext());
  if (useCookies && acc?.cookies) {
    await ctx.addCookies(parseCookieHeader(acc.cookies));
  }
  return { browser, ctx };
}

function parseCookieHeader(s) {
  const out = [];
  for (const x of s.split(";")) {
    const e = x.indexOf("=");
    if (e < 0) continue;
    const name = x.slice(0, e).trim();
    let value = x.slice(e + 1).trim().replace(/^"|"$/g, "");
    if (!name || !value) continue;
    for (const dom of [".tiktok.com", ".www.tiktok.com"]) {
      out.push({ name, value, domain: dom, path: "/", httpOnly: false, secure: true, sameSite: "Lax" });
    }
  }
  return out;
}

/**
 * page から指定 URL pattern の API レスポンスを intercept してコレクト.
 * navigate + scroll 用ヘルパー.
 *
 * @param {object} opts
 * @param {object} opts.page                Playwright page
 * @param {RegExp|string} opts.urlPattern   intercept する URL パターン
 * @param {(json) => any[]} [opts.parser]   レスポンス JSON から要素配列を抽出
 * @returns {{ collected: any[], rawResponses: any[], stop: () => void }}
 */
export function captureApiResponses({ page, urlPattern, parser }) {
  const matchUrl = typeof urlPattern === "string"
    ? (u) => u.includes(urlPattern)
    : (u) => urlPattern.test(u);
  const collected = [];
  const rawResponses = [];
  const handler = async (resp) => {
    const url = resp.url();
    if (!matchUrl(url)) return;
    try {
      const json = await resp.json();
      rawResponses.push({ url, status: resp.status(), json });
      if (parser) {
        const items = parser(json);
        if (Array.isArray(items)) collected.push(...items);
      }
    } catch {
      // body が空 / json じゃない時 skip
    }
  };
  page.on("response", handler);
  return {
    collected,
    rawResponses,
    stop: () => page.off("response", handler),
  };
}
