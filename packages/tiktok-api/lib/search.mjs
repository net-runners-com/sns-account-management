// TikTok 検索 API (X-Bogus 署名付き)
import { browserHeaders, baseApiParams, TIKTOK_UA } from "../session.mjs";
import { signParams } from "./sign/index.mjs";

const SEARCH_URL = "https://www.tiktok.com/api/search/general/full/";
const PREVIEW_URL = "https://www.tiktok.com/api/search/general/preview/";

/**
 * 検索結果取得 (signed)
 *
 * @param {object} acc
 * @param {object} opts
 * @param {string} opts.keyword
 * @param {number} [opts.offset=0]
 * @param {number} [opts.count=12]
 * @param {string} [opts.searchId]   2 ページ目以降は前回 response の search_id 渡す
 */
export async function searchGeneral(acc, { keyword, offset = 0, count = 12, searchId = "" } = {}) {
  if (!keyword) throw new Error("keyword required");
  const params = {
    ...baseApiParams(acc),
    from_page: "search",
    keyword,
    offset: String(offset),
    count: String(count),
    search_id: searchId,
  };
  const { signedUrl } = signParams({ url: SEARCH_URL, params, userAgent: TIKTOK_UA });
  const r = await fetch(signedUrl, {
    headers: browserHeaders(acc, { referer: `https://www.tiktok.com/search?q=${encodeURIComponent(keyword)}` }),
  });
  const text = await r.text();
  if (text.length === 0) {
    throw new Error(`empty body (HTTP ${r.status}) — X-Bogus rejected or rate-limited`);
  }
  let json;
  try { json = JSON.parse(text); }
  catch { throw new Error(`non-JSON response (HTTP ${r.status}): ${text.slice(0, 200)}`); }
  return json;
}

/**
 * 検索候補 (X-Bogus 不要、軽量 fallback)
 */
export async function searchSuggest(acc, { keyword } = {}) {
  if (!keyword) throw new Error("keyword required");
  const params = {
    ...baseApiParams(acc),
    from_page: "search",
    keyword,
  };
  const url = `${PREVIEW_URL}?${new URLSearchParams(params)}`;
  const r = await fetch(url, { headers: browserHeaders(acc, { referer: "https://www.tiktok.com/" }) });
  return await r.json();
}

/**
 * 検索結果から動画/ユーザー/ハッシュタグを抽出
 */
export function extractSearchResults(json) {
  const data = json?.data || [];
  const out = { videos: [], users: [], hashtags: [], search_id: json?.extra?.logid || null };
  for (const entry of data) {
    if (entry.type === 1 && entry.item) {
      out.videos.push(summarizeVideo(entry.item));
    } else if (entry.type === 4 && entry.user_list) {
      for (const u of entry.user_list) out.users.push(summarizeUser(u));
    } else if (entry.type === 2 && entry.aweme_info_list) {
      // user カードに紐づく動画群
      for (const v of entry.aweme_info_list) out.videos.push(summarizeVideo(v));
    } else if (entry.item) {
      out.videos.push(summarizeVideo(entry.item));
    }
  }
  out.has_more = !!json?.has_more;
  out.cursor = json?.cursor ?? null;
  return out;
}

function summarizeVideo(it) {
  const author = it.author || {};
  const stats = it.statistics || {};
  return {
    id: it.aweme_id || it.id,
    desc: it.desc || "",
    create_time: it.create_time,
    duration: it.video?.duration,
    play_url: it.video?.play_addr?.url_list?.[0],
    cover: it.video?.cover?.url_list?.[0],
    author: {
      id: author.uid,
      sec_uid: author.sec_uid,
      unique_id: author.unique_id,
      nickname: author.nickname,
      avatar: author.avatar_thumb?.url_list?.[0],
    },
    stats: {
      play: stats.play_count,
      digg: stats.digg_count,
      comment: stats.comment_count,
      share: stats.share_count,
      collect: stats.collect_count,
    },
    music: it.music
      ? { id: it.music.id, title: it.music.title, author: it.music.author }
      : null,
  };
}

function summarizeUser(u) {
  const ui = u.user_info || u;
  return {
    id: ui.uid,
    sec_uid: ui.sec_uid,
    unique_id: ui.unique_id,
    nickname: ui.nickname,
    follower_count: ui.follower_count,
    signature: ui.signature,
    avatar: ui.avatar_thumb?.url_list?.[0],
  };
}
