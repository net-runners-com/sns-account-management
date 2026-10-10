// 外部サービス埋め込み
// note.com 公式のembed登録API経由で embedded-content-key を取得し、body に figure を埋め込む
//
// 対応サービス（検証済✓）:
//   ✓ twitter / x        (twitter.com, x.com)
//   ✓ threads           (threads.com, threads.net)
//   ✓ youtube           (youtube.com, youtu.be)
//   ✓ spotify           (open.spotify.com)
//   ? instagram / tiktok / vimeo : iframely 側で弾かれることあり（URL依存）
//   ? note内部記事 : 別メカニズム要（"Not allowed iframely html"）

import crypto from "crypto";
import { authHeaders } from "./auth.mjs";

// URL → service名 自動判定
export function detectService(url) {
  if (/(?:twitter|x)\.com\//.test(url)) return "twitter";
  if (/threads\.(?:com|net)\//.test(url)) return "threads";
  if (/(?:youtube\.com|youtu\.be)\//.test(url)) return "youtube";
  if (/instagram\.com\//.test(url)) return "instagram";
  if (/tiktok\.com\//.test(url)) return "tiktok";
  if (/open\.spotify\.com\//.test(url)) return "spotify";
  if (/vimeo\.com\//.test(url)) return "vimeo";
  if (/soundcloud\.com\//.test(url)) return "soundcloud";
  if (/note\.com\//.test(url)) return "note";
  if (/amazon\.(?:co\.jp|com)\//.test(url)) return "amazon";
  if (/music\.apple\.com\//.test(url)) return "apple_music";
  return null;
}

// URL を note.com サーバーに登録して embedded-content-key を発行してもらう
// 返り値: { key: "emb<hex>", html_for_embed: "...", ... }
export async function registerEmbed(client, { noteKey, url, service }) {
  const svc = service || detectService(url);
  if (!svc) throw new Error(`service unknown for url: ${url}`);
  const q = new URLSearchParams({
    url,
    service: svc,
    embeddable_key: noteKey,
    embeddable_type: "Note",
  });
  const res = await fetch(`https://note.com/api/v2/embed_by_external_api?${q}`, {
    headers: authHeaders(client, { json: false, referer: "https://editor.note.com/", origin: "https://editor.note.com" }),
  });
  if (!res.ok) throw new Error(`registerEmbed[${svc}] failed ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json?.data || json;
}

// embed用 figure HTML 生成
export function embedFigure({ url, service, embeddedContentKey, figureUuid, innerHtml }) {
  const id = figureUuid || crypto.randomUUID();
  const inner = innerHtml ?? `<a href="${url}" rel="nofollow noopener"></a>`;
  return `<figure name="${id}" id="${id}" data-src="${url}" data-identifier="null" embedded-service="${service}" embedded-content-key="${embeddedContentKey}">${inner}</figure>`;
}

// 便利版: URL から一気に figure HTML を作る（registerEmbed + embedFigure）
// 失敗時は null を返す（body組立をブロックしない運用向け）
// throwOnError: true なら投げる
export async function embedUrl(client, { noteKey, url, service, throwOnError = false }) {
  try {
    const svc = service || detectService(url);
    const emb = await registerEmbed(client, { noteKey, url, service: svc });
    return embedFigure({ url, service: svc, embeddedContentKey: emb.key });
  } catch (e) {
    if (throwOnError) throw e;
    console.error(`[embedUrl] ${url}: ${e.message}`);
    return null;
  }
}
