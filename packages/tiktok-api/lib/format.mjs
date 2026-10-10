// TikTok アイテム整形 (web camelCase / app snake_case 両対応)
// user.mjs / video.mjs が共有。search.mjs / trending.mjs の summarizeVideo と互換。

const pick = (...xs) => xs.find((x) => x !== undefined && x !== null);
const urlList0 = (v) => (typeof v === "string" ? v : v?.url_list?.[0]);

// 動画 1 件の要約 (一覧表示用)
export function summarizeVideo(it) {
  const author = it.author || {};
  const stats = it.stats || it.statsV2 || it.statistics || {};
  const authorStats = it.authorStats || {};
  const id = pick(it.id, it.aweme_id);
  const uniqueId = pick(author.uniqueId, author.unique_id);
  return {
    id,
    desc: it.desc || "",
    create_time: pick(it.createTime, it.create_time),
    duration: it.video?.duration,
    cover: urlList0(pick(it.video?.cover, it.video?.originCover)),
    url: uniqueId && id ? `https://www.tiktok.com/@${uniqueId}/video/${id}` : null,
    author: {
      id: pick(author.id, author.uid),
      sec_uid: pick(author.secUid, author.sec_uid),
      unique_id: uniqueId,
      nickname: author.nickname,
      verified: !!author.verified,
      follower_count: pick(authorStats.followerCount, author.followerCount),
    },
    stats: {
      play: Number(pick(stats.playCount, stats.play_count, 0)),
      digg: Number(pick(stats.diggCount, stats.digg_count, 0)),
      comment: Number(pick(stats.commentCount, stats.comment_count, 0)),
      share: Number(pick(stats.shareCount, stats.share_count, 0)),
      collect: Number(pick(stats.collectCount, stats.collect_count, 0)),
      repost: Number(pick(stats.repostCount, 0)),
    },
    music: it.music ? { id: it.music.id, title: it.music.title, author: pick(it.music.authorName, it.music.author) } : null,
    is_ad: !!it.isAd,
  };
}

// ユーザー 1 件の要約
export function summarizeUser(u) {
  const ui = u.user || u.userInfo?.user || u.user_info || u;
  const stats = u.stats || u.userInfo?.stats || ui.stats || {};
  return {
    id: pick(ui.id, ui.uid),
    sec_uid: pick(ui.secUid, ui.sec_uid),
    unique_id: pick(ui.uniqueId, ui.unique_id),
    nickname: ui.nickname,
    signature: ui.signature,
    verified: !!ui.verified,
    private: !!pick(ui.privateAccount, ui.secret),
    avatar: urlList0(pick(ui.avatarLarger, ui.avatarMedium, ui.avatarThumb)),
    region: ui.region,
    follower_count: Number(pick(stats.followerCount, ui.followerCount, 0)),
    following_count: Number(pick(stats.followingCount, ui.followingCount, 0)),
    video_count: Number(pick(stats.videoCount, ui.videoCount, 0)),
    heart_count: Number(pick(stats.heartCount, stats.heart, ui.heartCount, 0)),
  };
}

// 動画 1 件のフル詳細 (video.mjs 用) — ハッシュタグ / メンション / 音源 / 動画メタまで
export function summarizeDetail(it) {
  const author = it.author || {};
  const stats = it.stats || it.statsV2 || {};
  const authorStats = it.authorStats || {};
  const v = it.video || {};
  const id = pick(it.id, it.aweme_id);
  const uniqueId = pick(author.uniqueId, author.unique_id);

  const hashtags = [], mentions = [];
  for (const t of it.textExtra || []) {
    if (t.hashtagName) hashtags.push(t.hashtagName);
    else if (t.userUniqueId) mentions.push(t.userUniqueId);
  }

  return {
    id,
    url: uniqueId && id ? `https://www.tiktok.com/@${uniqueId}/video/${id}` : null,
    desc: it.desc || "",
    create_time: pick(it.createTime, it.create_time),
    create_time_iso: it.createTime ? new Date(Number(it.createTime) * 1000).toISOString() : null,
    region: it.locationCreated || it.region,
    hashtags,
    mentions,
    author: {
      id: pick(author.id, author.uid),
      sec_uid: pick(author.secUid, author.sec_uid),
      unique_id: uniqueId,
      nickname: author.nickname,
      signature: author.signature,
      verified: !!author.verified,
      avatar: urlList0(pick(author.avatarLarger, author.avatarThumb)),
      follower_count: Number(pick(authorStats.followerCount, 0)),
      following_count: Number(pick(authorStats.followingCount, 0)),
      heart_count: Number(pick(authorStats.heartCount, authorStats.heart, 0)),
      video_count: Number(pick(authorStats.videoCount, 0)),
    },
    stats: {
      play: Number(pick(stats.playCount, stats.play_count, 0)),
      digg: Number(pick(stats.diggCount, stats.digg_count, 0)),
      comment: Number(pick(stats.commentCount, stats.comment_count, 0)),
      share: Number(pick(stats.shareCount, stats.share_count, 0)),
      collect: Number(pick(stats.collectCount, stats.collect_count, 0)),
      repost: Number(pick(stats.repostCount, 0)),
    },
    video: {
      duration: v.duration,
      ratio: v.ratio,
      width: v.width,
      height: v.height,
      cover: urlList0(v.cover),
      origin_cover: urlList0(v.originCover),
      dynamic_cover: urlList0(v.dynamicCover),
      play_url: urlList0(pick(v.playAddr, v.play_addr)),
      download_url: urlList0(pick(v.downloadAddr, v.download_addr)),
      bitrate: v.bitrate,
      format: v.format,
    },
    music: it.music
      ? {
          id: it.music.id,
          title: it.music.title,
          author: pick(it.music.authorName, it.music.author),
          original: !!it.music.original,
          duration: it.music.duration,
          play_url: urlList0(it.music.playUrl),
        }
      : null,
    challenges: (it.challenges || []).map((c) => ({ id: pick(c.id, c.cid), title: pick(c.title, c.cha_name) })),
    is_ad: !!it.isAd,
  };
}

export const fmt = (n) => Number(n ?? 0).toLocaleString("en-US");

// "xxpeony" / "@xxpeony" / "https://www.tiktok.com/@xxpeony[/...]" → "xxpeony"
export function parseUsername(s) {
  const m = String(s).match(/tiktok\.com\/@([^/?#]+)/i);
  return (m ? m[1] : String(s)).replace(/^@/, "").trim();
}

// 動画 URL / id から { id, author } を抽出
export function parseVideoRef(s) {
  const str = String(s).trim();
  const m = str.match(/tiktok\.com\/@([^/]+)\/video\/(\d+)/i);
  if (m) return { author: m[1], id: m[2] };
  const idm = str.match(/(\d{6,})/); // bare numeric id
  if (idm) return { author: null, id: idm[1] };
  return { author: null, id: null };
}
