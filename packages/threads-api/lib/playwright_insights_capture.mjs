// Playwright で投稿インサイトモーダルを開いて GraphQL request をキャプチャ
//
// 戦略: 投稿 URL に hash route `/insights` 付きで navigate
//       → モーダル出る → GraphQL request captured
import { chromium } from "playwright";
import { getAccount } from "../session.mjs";

function parseCookieHeader(cookieStr) {
  const out = [];
  for (const s of cookieStr.split(";")) {
    const eq = s.indexOf("=");
    if (eq < 0) continue;
    const name = s.slice(0, eq).trim();
    let value = s.slice(eq + 1).trim().replace(/^"|"$/g, "");
    if (!name || !value) continue;
    value = value.replace(/\\(\d{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
    out.push({ name, value, domain: ".threads.com", path: "/", httpOnly: false, secure: true, sameSite: "None" });
    out.push({ name, value, domain: ".instagram.com", path: "/", httpOnly: false, secure: true, sameSite: "None" });
  }
  return out;
}

/**
 * 投稿 URL を開いて post insights モーダルを発火 → GraphQL 全 capture
 *
 * @param {object} opts
 * @param {string} opts.postUrl     例 https://www.threads.com/@hiro_.ai/post/DWWOzVcj0wp
 * @param {string} opts.accountName ログイン用 (cookies)
 * @param {boolean} [opts.headless] default true
 * @returns {Promise<{captures: Array<{friendlyName, docId, variables, response}>}>}
 */
export async function captureInsightsRequest({ postUrl, accountName, headless = true } = {}) {
  if (!postUrl) throw new Error("postUrl required");
  if (!accountName) throw new Error("accountName required");
  const acc = getAccount(accountName);
  if (!acc.cookies) throw new Error(`no cookies for ${accountName}`);

  const captures = [];
  const browser = await chromium.launch({
    headless,
    args: ["--disable-blink-features=AutomationControlled"],
  });
  try {
    const ctx = await browser.newContext({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 900 },
      locale: "ja-JP",
    });
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });
    await ctx.addCookies(parseCookieHeader(acc.cookies));
    const page = await ctx.newPage();

    page.on("response", async (resp) => {
      try {
        if (!resp.url().includes("/api/graphql")) return;
        const req = resp.request();
        const friendlyName = req.headers()["x-fb-friendly-name"];
        const postData = req.postData() || "";
        const docId = postData.match(/(?:^|&)doc_id=(\d+)/)?.[1];
        const varsStr = postData.match(/(?:^|&)variables=([^&]+)/)?.[1];
        let variables = null;
        try { variables = varsStr ? JSON.parse(decodeURIComponent(varsStr)) : null; } catch {}
        const ct = (resp.headers()["content-type"] || "");
        let response = null;
        if (ct.includes("json") || ct.includes("javascript")) {
          try { response = JSON.parse(await resp.text()); } catch {}
        }
        captures.push({ friendlyName, docId, variables, response });
      } catch (e) {}
    });

    // step 1: 投稿詳細ページ open (no hash)
    await page.goto(postUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2500);

    // step 2: hash route 付きで再 navigate (モーダル発火)
    await page.evaluate((url) => {
      window.history.pushState(null, "", url + "#/");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
      window.dispatchEvent(new PopStateEvent("popstate"));
    }, postUrl);
    await page.waitForTimeout(3000);

    // step 3: もしモーダル発火しないなら 3点メニュー → 「インサイトを表示」 を試す
    try {
      // click 3-dots overflow on the post
      await page.locator('[aria-label*="その他"], [aria-label*="More"]').first().click({ timeout: 3000 });
      await page.waitForTimeout(500);
      // click "インサイト" / "Insights"
      await page.locator('text=/インサイト|Insights/').first().click({ timeout: 3000 });
      await page.waitForTimeout(2500);
    } catch {}

    return { captures };
  } finally {
    await browser.close();
  }
}
