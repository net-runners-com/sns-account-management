// Threads フォロー / アンフォロー (web GraphQL 経由)
//   useTHFollowMutationFollowMutation
//   variables: { target_user_id: <Threads ds_user_id>, ... }
import { callGraphQL } from "./graphql.mjs";

/**
 * Threads ユーザーをフォロー
 * @param {object} opts
 * @param {string} opts.accountName     使うアカウント (clean web session)
 * @param {string|number} opts.targetUserId  対象の Threads ds_user_id (IG pk じゃないので注意)
 */
export async function followUser({ accountName, targetUserId } = {}) {
  if (!targetUserId) throw new Error("targetUserId required (Threads ds_user_id)");
  return await callGraphQL({
    accountName,
    friendlyName: "useTHFollowMutationFollowMutation",
    variables: {
      target_user_id: String(targetUserId),
      media_id_attribution: null,
      container_module: "ig_text_feed_profile",
      ranking_info_token: null,
      barcelona_source_quote_post_id: null,
      barcelona_source_reply_id: null,
    },
    referer: "https://www.threads.com/",
    crn: "comet.threads.BarcelonaProfileThreadsColumnRoute",
  });
}
