// Threads トレンド一覧取得 (Playwright DOM scrape)
//
// /search ページを開いて Trends widget をレンダ → DOM から
// `<a href*="trend_fbid">` 要素を全部抽出. 各要素は q (検索キーワード) +
// trend_fbid (固有ID) + 投稿件数 + ヘッドライン を持つ.
import { chromium } from "playwright";
import { getAccount } from "../session.mjs";

function parseCookieHeader(s) {
  const out = [];
  for (const x of s.split(";")) {
    const eq = x.indexOf("="); if (eq < 0) continue;
    let v = x.slice(eq + 1).trim().replace(/^"|"$/g, "");
    v = v.replace(/\\(\d{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)));
    const n = x.slice(0, eq).trim();
    if (!n || !v) continue;
    out.push({ name: n, value: v, domain: ".threads.com", path: "/", httpOnly: false, secure: true, sameSite: "None" });
    out.push({ name: n, value: v, domain: ".instagram.com", path: "/", httpOnly: false, secure: true, sameSite: "None" });
  }
  return out;
}

/**
 * トレンド一覧
 *
 * @param {object} opts
 * @param {string} opts.accountName  ログイン用アカウント (cookies)
 * @param {boolean} [opts.headless]  default true
 * @param {number} [opts.scrolls]    トレンド全件出すための scroll 回数 default 5
 */
export async function getTrends({ accountName, headless = true, scrolls = 5 } = {}) {
  if (!accountName) throw new Error("accountName required");
  const acc = getAccount(accountName);
  if (!acc.cookies) throw new Error(`no cookies for ${accountName}`);

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

    await page.goto("https://www.threads.com/search", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);

    // トレンド要素が出るまで待つ (timeout 8s)
    try {
      await page.waitForSelector("a[href*='trend_fbid']", { timeout: 8000 });
    } catch {}

    // スクロールで全件出す
    for (let i = 0; i < scrolls; i++) {
      await page.mouse.wheel(0, 700);
      await page.waitForTimeout(800);
    }

    // 抽出
    const trends = await page.evaluate(() => {
      const seen = new Set();
      const out = [];
      for (const a of document.querySelectorAll("a[href*='trend_fbid']")) {
        const url = new URL(a.href);
        const q = url.searchParams.get("q") || "";
        const trend_fbid = url.searchParams.get("trend_fbid") || "";
        const key = trend_fbid;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        // text は重複が出るので、innerText が空じゃない最初のを取る
        const text = (a.innerText || "").trim();
        // headline (1行目) と subhead (2行目) と count を分離
        const lines = text.split(/\n/).map((s) => s.trim()).filter(Boolean);
        const count_match = lines.join(" ").match(/投稿\s*([\d.,万]+)\s*件/);
        out.push({
          q,
          trend_fbid,
          headline: lines[0] || null,
          summary: lines[1] || null,
          post_count_text: count_match?.[1] || null,
          url: a.href,
          all_text: text,
        });
      }
      return out;
    });

    return trends;
  } finally {
    await browser.close();
  }
}

export function summarizeTrends(trends) {
  return trends.map((t, i) => ({
    rank: i + 1,
    headline: t.headline,
    keyword: t.q,
    posts: t.post_count_text,
    summary: t.summary,
    trend_fbid: t.trend_fbid,
  }));
}
