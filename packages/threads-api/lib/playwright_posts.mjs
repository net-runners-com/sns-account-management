// Playwright で全投稿スクレイプ
//
// アプローチ: cookie 流し込み + 自動スクロール + GraphQL response 横取り.
// /api/graphql の response から media items を抽出 (フィード読み込み毎に追記).
// DOM スクレイプより stable (内部 schema 変わってもメトリクスは取れる).
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
    // octal escape (\054 = , 等) を本来の文字に戻す (Playwright が冷たく rejectしないため)
    value = value.replace(/\\(\d{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
    // Threads.com と Instagram.com 両方に展開 (Meta は両方で session を持つ)
    out.push({ name, value, domain: ".threads.com", path: "/", httpOnly: false, secure: true, sameSite: "None" });
    out.push({ name, value, domain: ".instagram.com", path: "/", httpOnly: false, secure: true, sameSite: "None" });
  }
  return out;
}

function summarizePost(p) {
  const captionText = p.caption?.text || p.text_post_app_info?.text_with_entities?.text || null;
  return {
    pk: p.pk,
    code: p.code || null,
    taken_at: p.taken_at || null,
    text: captionText,
    counts: {
      likes: p.like_count ?? null,
      replies: p.text_post_app_info?.direct_reply_count ?? null,
      reposts: p.text_post_app_info?.repost_count ?? null,
      quotes: p.text_post_app_info?.quote_count ?? null,
      shares: p.share_count ?? null,
    },
    has_media: !!(p.image_versions2?.candidates?.length || p.video_versions?.length),
    is_pinned: p.text_post_app_info?.is_post_pinned ?? null,
    user: p.user ? { pk: p.user.pk, username: p.user.username } : null,
    url: p.code && p.user?.username ? `https://www.threads.com/@${p.user.username}/post/${p.code}` : null,
  };
}

function walkAndCollect(o, posts, depth = 0) {
  if (depth > 50 || o == null) return;
  if (Array.isArray(o)) { for (const x of o) walkAndCollect(x, posts, depth + 1); return; }
  if (typeof o !== "object") return;
  if (typeof o.pk === "string" && /^\d+$/.test(o.pk)) {
    const looksLikePost =
      "like_count" in o || "text_post_app_info" in o || "caption" in o ||
      ("__typename" in o && /XDTMedia|Media/i.test(o.__typename || ""));
    if (looksLikePost && !posts.has(o.pk)) {
      posts.set(o.pk, summarizePost(o));
    }
  }
  for (const k of Object.keys(o)) walkAndCollect(o[k], posts, depth + 1);
}

/**
 * 自動スクロール + GraphQL 横取りで全投稿
 * @param {object} opts
 * @param {string} opts.username        対象ユーザー名 (@抜き)
 * @param {string} opts.accountName     ログイン中アカウント (cookies で認証)
 * @param {number} [opts.maxScrolls]    最大スクロール回数 (default 50)
 * @param {number} [opts.scrollWaitMs]  スクロール毎の待ち (default 1500ms)
 * @param {boolean} [opts.headless]     headless mode (default true)
 * @param {function} [opts.onProgress]  毎フェーズで {scrolls, posts} を受け取る
 * @returns {Promise<{posts:Array, friendlyNames:Array, docIds:Object}>}
 */
export async function scrapeUserPosts({
  username, accountName, maxScrolls = 50, scrollWaitMs = 1500,
  headless = true, onProgress,
} = {}) {
  if (!username) throw new Error("username required");
  if (!accountName) throw new Error("accountName required");
  const acc = getAccount(accountName);
  if (!acc.cookies) throw new Error(`no cookies for ${accountName}`);

  const u = String(username).replace(/^@/, "");
  const posts = new Map();
  const friendlyNames = new Set();
  const docIds = {};
  let graphqlResponseCount = 0;

  const browser = await chromium.launch({
    headless,
    args: ["--disable-blink-features=AutomationControlled"],
  });
  try {
    const ctx = await browser.newContext({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 900 },  // 通常画面サイズ (スクロール余地を残す)
      locale: "ja-JP",
    });
    // navigator.webdriver = undefined にして headless 検知回避
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });
    await ctx.addCookies(parseCookieHeader(acc.cookies));
    const page = await ctx.newPage();

    // GraphQL response 横取り + JS bundle から doc_id 抽出
    page.on("response", async (resp) => {
      try {
        const url = resp.url();

        // GraphQL POST の場合
        if (url.includes("/api/graphql")) {
          const req = resp.request();
          const friendlyName = req.headers()["x-fb-friendly-name"];
          if (friendlyName) friendlyNames.add(friendlyName);
          const postData = req.postData() || "";
          const docMatch = postData.match(/(?:^|&)doc_id=(\d+)/);
          if (friendlyName && docMatch && !docIds[friendlyName]) docIds[friendlyName] = docMatch[1];

          const ct = (resp.headers()["content-type"] || "");
          if (!ct.includes("json") && !ct.includes("javascript")) return;
          const text = await resp.text();
          let json; try { json = JSON.parse(text); } catch { return; }
          graphqlResponseCount++;
          const before = posts.size;
          walkAndCollect(json, posts);
          if (posts.size > before && onProgress) onProgress({ phase: "intercept", scrolls: 0, posts: posts.size, friendlyName });
          return;
        }

        // JS bundle 内の friendly_name → doc_id 紐付け
        if (url.endsWith(".js") || url.includes(".js?")) {
          const text = await resp.text();
          // Relay コンパイル済 query の signature: id:"<doc_id>", name:"BarcelonaXxxQuery"
          for (const m of text.matchAll(/id:"(\d{15,20})",[^"]*name:"(Barcelona[A-Za-z]+(?:Mutation|Query|Subscription))"/g)) {
            const [, id, name] = m;
            if (!docIds[name]) {
              docIds[name] = id;
              friendlyNames.add(name);
            }
          }
          // 別パターン: "queryId":"<doc_id>", "queryName":"Xxx"
          for (const m of text.matchAll(/"id":"(\d{15,20})"[^}]*"name":"(Barcelona[A-Za-z]+(?:Mutation|Query|Subscription))"/g)) {
            const [, id, name] = m;
            if (!docIds[name]) {
              docIds[name] = id;
              friendlyNames.add(name);
            }
          }
        }
      } catch (e) {}
    });

    await page.goto(`https://www.threads.com/@${u}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2500);  // SSR posts 反映待ち

    // Refetchable chunk load を強制: replies tab に行って戻る (client-side navigation)
    try {
      await page.goto(`https://www.threads.com/@${u}/replies`, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(1500);
      await page.goto(`https://www.threads.com/@${u}`, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(1500);
    } catch {}

    // ログイン状態の検証 — actorID が JSON 内にあれば logged-in
    const loginCheck = await page.evaluate(() => {
      const html = document.documentElement.innerHTML;
      const m = html.match(/"actorID":"(\d+)"/);
      const isLoggedIn = m && m[1] !== "0";
      const hasLoginPrompt = html.includes("BARCELONA_FOR_WEB_APP_OPEN_PROMPT") || /class="[^"]*loginPrompt/i.test(html);
      return { actorID: m?.[1] || null, isLoggedIn, hasLoginPrompt };
    });
    if (onProgress) onProgress({ phase: "auth", ...loginCheck });
    if (!loginCheck.isLoggedIn) {
      // cookie 受け入れ失敗 — 警告のみ (logged-out でも 5-12 件は取れる)
      console.warn(`[playwright] WARNING: not logged in (actorID=${loginCheck.actorID}). pagination beyond ~5 posts may fail.`);
    }

    // 初回 SSR 反映 (HTML scrape 同等)
    walkAndCollect(await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('script[type="application/json"]').forEach((s) => {
        try { out.push(JSON.parse(s.textContent)); } catch {}
      });
      return out;
    }), posts);

    // 自動スクロール: マウスホイール + 最終要素 scrollIntoView (人間っぽく)
    let lastHeight = await page.evaluate(() => document.body.scrollHeight);
    let lastPostCount = posts.size;
    let stableCount = 0;
    for (let i = 0; i < maxScrolls; i++) {
      // 大量にホイール送る (1スクロールで複数回イベント)
      for (let j = 0; j < 6; j++) {
        await page.mouse.wheel(0, 800 + Math.floor(Math.random() * 400));
        await page.waitForTimeout(150 + Math.floor(Math.random() * 200));
      }
      // 最終 post を viewport に入れて IntersectionObserver 発火させる
      try {
        await page.evaluate(() => {
          const items = document.querySelectorAll('[data-pressable-container],article,[role="article"]');
          if (items.length) items[items.length - 1].scrollIntoView({ behavior: "auto", block: "end" });
          window.scrollBy(0, 1200);
        });
      } catch {}
      await page.waitForTimeout(scrollWaitMs);
      const newHeight = await page.evaluate(() => document.body.scrollHeight);
      if (onProgress) onProgress({ phase: "scroll", scrolls: i + 1, posts: posts.size, height: newHeight });
      if (newHeight === lastHeight && posts.size === lastPostCount) {
        stableCount++;
        if (stableCount >= 4) break;  // 4回連続で何も増えず → 終了
      } else {
        stableCount = 0;
      }
      lastHeight = newHeight;
      lastPostCount = posts.size;
    }

    return {
      posts: [...posts.values()].sort((a, b) => Number(b.pk) - Number(a.pk)),
      friendlyNames: [...friendlyNames],
      docIds,
      graphqlResponseCount,
    };
  } finally {
    await browser.close();
  }
}
