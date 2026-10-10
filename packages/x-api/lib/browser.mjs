// Camoufox (anti-detect Firefox) で X (Twitter) の SearchTimeline 等を intercept
// 純 HTTP では x-client-transaction-id 必須で 404 になるため.
import { Camoufox } from "camoufox-js";

export async function launchCamoufox({ headless = true, acc = null, useCookies = true } = {}) {
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
    out.push({ name, value, domain: ".x.com", path: "/", httpOnly: false, secure: true, sameSite: "Lax" });
  }
  return out;
}

/**
 * page で指定パターンの API レスポンスを intercept してコレクト.
 * resp.json() を非同期で取って parser に渡す.
 */
export function captureApiResponses({ page, urlPattern, parser }) {
  const matchUrl = typeof urlPattern === "string" ? (u) => u.includes(urlPattern) : (u) => urlPattern.test(u);
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
      // body が空 / non-json は skip
    }
  };
  page.on("response", handler);
  return {
    collected,
    rawResponses,
    stop: () => page.off("response", handler),
  };
}
