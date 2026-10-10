// Threads GIF 検索 (Giphy 経由) - BarcelonaAnimatedImageAttachmentPickerRefetchQuery
//
// 入力: 検索ワード (string, 短いキーワード推奨)
// 出力: 配列 { gif_media_id, image_url, title }  ← gif_media_id が dm.mjs --gif に渡す値
import { callGraphQL } from "./graphql.mjs";

/**
 * Threads compose の GIF picker と同じ Giphy 検索を実行.
 *
 * @param {object} opts
 * @param {string} opts.accountName
 * @param {string} opts.query        検索ワード
 * @param {number} [opts.limit]      返す上限数 (Threads は 60 程度返す)
 */
export async function searchGifs({ accountName, query, limit = 30 } = {}) {
  if (!accountName) throw new Error("accountName required");
  if (!query) throw new Error("query required");
  const r = await callGraphQL({
    accountName,
    friendlyName: "BarcelonaAnimatedImageAttachmentPickerRefetchQuery",
    variables: { search_query: query },
    referer: "https://www.threads.com/",
  });
  // 応答: data.giphyImages.images[]
  const arr = r.json?.data?.giphyImages?.images || [];
  const items = arr.slice(0, limit).map((g) => ({
    gif_media_id: g.id,                              // ← post.mjs --gif に渡す ID
    preview_url: g.preview_image_fixed_width?.url || g.preview_image_original?.url || null,
    original_url: g.preview_image_original?.url || null,
    width: g.preview_image_original?.width ?? null,
    height: g.preview_image_original?.height ?? null,
    title: g.title || g.alt_text || null,
  }));

  return { items, raw: r.json };
}
