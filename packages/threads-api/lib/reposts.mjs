// Threads リポスト
//   POST /api/graphql  friendlyName=useTHCreateRepostMutation
//   variables: { mediaID: <pk> }
import { callGraphQL, normalizePk } from "./graphql.mjs";

export async function repost({ accountName, mediaRef } = {}) {
  const pk = normalizePk(mediaRef);
  return await callGraphQL({
    accountName,
    friendlyName: "useTHCreateRepostMutation",
    variables: { mediaID: pk },
    referer: `https://www.threads.com/`,
    crn: "comet.threads.BarcelonaPostColumnRoute",
  });
}
