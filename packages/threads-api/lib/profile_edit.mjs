// 自分のプロフィール編集 (Threads web)
//
// 実装 mutation:
//   useBarcelonaEditProfileMutation       - bio / name / username / external_url / is_private / profile_picture
//   useBarcelonaUpdateBioInterestsMutation - profile_tags (興味・関心)
import { getAccount } from "../session.mjs";
import { callGraphQL } from "./graphql.mjs";

/**
 * プロフィール基本情報を更新
 *
 * @param {object} opts
 * @param {string} opts.accountName
 * @param {string} [opts.biography]            自己紹介
 * @param {string} [opts.name]                 表示名 (空文字 OK)
 * @param {string} [opts.username]             username (変更可)
 * @param {string} [opts.external_url]         外部リンク URL
 * @param {boolean} [opts.is_private]          公開/非公開
 * @param {string} [opts.profile_picture_upload_id]  新プロフィール画像の upload_id
 * @param {boolean} [opts.remove_profile_picture]    画像削除
 * @param {boolean} [opts.copy_ig_profile_picture]   IG 画像コピー
 *
 * 注意: 全フィールドは省略可能だが、サーバ側は **未指定なら現在値を保持** ではなく
 *       未指定フィールドが null/undefined だと「変更しない」扱い. 動作に応じて要検証.
 *       安全策: BarcelonaProfileEditDialogQuery で現在値を取って差分のみ送る.
 */
export async function editProfile({
  accountName,
  biography, name, username, external_url, is_private,
  profile_picture_upload_id = null,
  remove_profile_picture = false,
  copy_ig_profile_picture = false,
} = {}) {
  if (!accountName) throw new Error("accountName required");
  const acc = getAccount(accountName);
  // 現在の username を default に (変更指定なければ維持)
  const variables = {
    external_url: external_url ?? "",
    biography: biography ?? "",
    username: username ?? acc.username,
    name: name ?? "",
    is_private: !!is_private,
    profile_picture_upload_id,
    remove_profile_picture: !!remove_profile_picture,
    copy_ig_profile_picture_to_text_post_app: !!copy_ig_profile_picture,
  };
  return await callGraphQL({
    accountName,
    friendlyName: "useBarcelonaEditProfileMutation",
    rootFieldName: "xdt_text_app_edit_profile",
    variables,
    referer: `https://www.threads.com/@${acc.username || ""}`,
    crn: "comet.threads.BarcelonaProfileThreadsColumnRoute",
  });
}

/**
 * 興味・関心 (profile_tags) を更新
 *
 * @param {object} opts
 * @param {string} opts.accountName
 * @param {string[]} opts.tags  例: ["AI", "プログラミング"]
 */
export async function updateInterests({ accountName, tags } = {}) {
  if (!accountName) throw new Error("accountName required");
  if (!Array.isArray(tags)) throw new Error("tags array required");
  const acc = getAccount(accountName);
  return await callGraphQL({
    accountName,
    friendlyName: "useBarcelonaUpdateBioInterestsMutation",
    rootFieldName: "xdt_text_app_update_bio_interests",
    variables: { profile_tags: tags },
    referer: `https://www.threads.com/@${acc.username || ""}`,
    crn: "comet.threads.BarcelonaProfileThreadsColumnRoute",
  });
}

/**
 * Bio リンクを追加 / 編集 (link_id null で新規)
 *
 * @param {object} opts
 * @param {string} opts.accountName
 * @param {string} opts.url             リンク URL
 * @param {string} [opts.title]         表示名
 * @param {string} [opts.linkId]        既存リンク id (編集の場合)
 */
export async function upsertBioLink({ accountName, url, title = "", linkId = null } = {}) {
  if (!accountName) throw new Error("accountName required");
  if (!url) throw new Error("url required");
  const acc = getAccount(accountName);
  return await callGraphQL({
    accountName,
    friendlyName: "useBarcelonaCreateOrUpdateBioLinkMutation",
    rootFieldName: "xdt_text_app_create_or_update_bio_link",
    variables: { link_id: linkId, title, url },
    referer: `https://www.threads.com/@${acc.username || ""}`,
    crn: "comet.threads.BarcelonaProfileThreadsColumnRoute",
  });
}

/**
 * Bio リンク削除
 *
 * @param {object} opts
 * @param {string} opts.accountName
 * @param {string} opts.linkId    削除する link_id (getProfileEditState で取得)
 */
export async function removeBioLink({ accountName, linkId } = {}) {
  if (!accountName) throw new Error("accountName required");
  if (!linkId) throw new Error("linkId required");
  const acc = getAccount(accountName);
  return await callGraphQL({
    accountName,
    friendlyName: "useBarcelonaRemoveBioLinkMutation",
    rootFieldName: "xdt_text_app_remove_bio_link",
    variables: { link_id: String(linkId) },
    referer: `https://www.threads.com/@${acc.username || ""}`,
    crn: "comet.threads.BarcelonaProfileThreadsColumnRoute",
  });
}

/**
 * Instagram バッジ表示切替
 *
 * @param {object} opts
 * @param {string} opts.accountName
 * @param {boolean} opts.show          true=表示 / false=非表示
 */
export async function setInstagramBadge({ accountName, show } = {}) {
  if (!accountName) throw new Error("accountName required");
  const acc = getAccount(accountName);
  return await callGraphQL({
    accountName,
    friendlyName: "useBarcelonaShowIGBadgeMutationMutation",
    rootFieldName: "xdt_text_app_set_show_text_post_app_badge",
    variables: { text_post_app_badge_status: show ? "show_text_post_app_badge" : "hide_text_post_app_badge" },
    referer: `https://www.threads.com/@${acc.username || ""}`,
    crn: "comet.threads.BarcelonaProfileThreadsColumnRoute",
  });
}

/**
 * 編集ダイアログのクエリ (現在のプロフィール状態取得).
 *
 * 注意: tlsFetch 経由だと viewer:null になるバグがあるため global fetch で実装.
 * 戻り値: { json: <生レスポンス>, viewer: <便宜>, bio_links: [{link_id, title, url}] }
 */
export async function getProfileEditState({ accountName } = {}) {
  if (!accountName) throw new Error("accountName required");
  const acc = getAccount(accountName);
  if (!acc.cookies) throw new Error(`account "${accountName}" cookies missing`);

  // ホーム HTML から fb_dtsg / lsd / av 取得
  const homeHtml = await (await fetch("https://www.threads.com/", {
    headers: {
      Cookie: acc.cookies,
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
    },
  })).text();
  const fb_dtsg = (homeHtml.match(/"DTSGInitialData"[^{]*\{"token":"([^"]+)"/) || [])[1];
  const lsd = (homeHtml.match(/"LSD"[^{]*\{"token":"([^"]+)"/) || [])[1];
  const av = (homeHtml.match(/"actorID":"(\d+)"/) || [])[1] || "0";

  const { computeJazoest } = await import("./encryption.mjs");
  const body = new URLSearchParams({
    av, fb_dtsg, lsd,
    jazoest: computeJazoest(fb_dtsg),
    fb_api_caller_class: "RelayModern",
    fb_api_req_friendly_name: "BarcelonaProfileEditDialogQuery",
    server_timestamps: "true",
    variables: JSON.stringify({
      __relay_internal__pv__BarcelonaHasEventBadgerelayprovider: false,
      __relay_internal__pv__BarcelonaIsSettings2PrivacyMigrationEnabledrelayprovider: true,
      __relay_internal__pv__BarcelonaHasCommunityTopContributorsrelayprovider: false,
    }),
    doc_id: "34761408790172749",
  }).toString();

  const r = await fetch("https://www.threads.com/graphql/query", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-CSRFToken": acc.csrftoken,
      "X-IG-App-ID": "238260118697367",
      "X-FB-Friendly-Name": "BarcelonaProfileEditDialogQuery",
      Cookie: acc.cookies,
      Origin: "https://www.threads.com",
      Referer: `https://www.threads.com/@${acc.username || ""}`,
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
    },
    body,
  });
  const json = await r.json().catch(() => ({}));

  // bio_links 抽出 (深く walk)
  const bioLinks = [];
  function walk(o) {
    if (!o || typeof o !== "object") return;
    if (Array.isArray(o)) { for (const x of o) walk(x); return; }
    if (o.link_id !== undefined && o.url !== undefined) {
      bioLinks.push({ link_id: String(o.link_id || ""), title: o.title || "", url: o.url || "" });
    }
    for (const k of Object.keys(o)) walk(o[k]);
  }
  walk(json?.data);

  return { http: r.status, json, bio_links: bioLinks };
}

/**
 * Bio リンクを link_id 付きで取得 (削除/編集用)
 *
 * BarcelonaEditProfileLinksPageQuery 経由. ProfileEditDialog より詳細な link 情報.
 */
export async function listBioLinks({ accountName } = {}) {
  if (!accountName) throw new Error("accountName required");
  const acc = getAccount(accountName);
  if (!acc.cookies) throw new Error(`account "${accountName}" cookies missing`);

  const homeHtml = await (await fetch("https://www.threads.com/", {
    headers: { Cookie: acc.cookies, "User-Agent": "Mozilla/5.0 Chrome/147" },
  })).text();
  const fb_dtsg = (homeHtml.match(/"DTSGInitialData"[^{]*\{"token":"([^"]+)"/) || [])[1];
  const lsd = (homeHtml.match(/"LSD"[^{]*\{"token":"([^"]+)"/) || [])[1];
  const av = (homeHtml.match(/"actorID":"(\d+)"/) || [])[1] || "0";
  const { computeJazoest } = await import("./encryption.mjs");

  const body = new URLSearchParams({
    av, fb_dtsg, lsd,
    jazoest: computeJazoest(fb_dtsg),
    fb_api_caller_class: "RelayModern",
    fb_api_req_friendly_name: "BarcelonaEditProfileLinksPageQuery",
    server_timestamps: "true",
    variables: "{}",
    doc_id: "9653426861418870",
  }).toString();

  const r = await fetch("https://www.threads.com/graphql/query", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-CSRFToken": acc.csrftoken,
      "X-IG-App-ID": "238260118697367",
      "X-FB-Friendly-Name": "BarcelonaEditProfileLinksPageQuery",
      Cookie: acc.cookies,
      Origin: "https://www.threads.com",
      Referer: `https://www.threads.com/@${acc.username || ""}`,
      "User-Agent": "Mozilla/5.0 Chrome/147",
    },
    body,
  });
  const json = await r.json().catch(() => ({}));

  // walk for link entries with link_id
  const links = [];
  function walk(o) {
    if (!o || typeof o !== "object") return;
    if (Array.isArray(o)) { for (const x of o) walk(x); return; }
    if (o.link_id && o.url) {
      links.push({ link_id: String(o.link_id), title: o.title || "", url: o.url, link_type: o.link_type || null });
    }
    for (const k of Object.keys(o)) walk(o[k]);
  }
  walk(json?.data);
  return { http: r.status, json, links };
}
