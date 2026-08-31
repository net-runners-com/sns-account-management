// X API programmatic 入口
// 使用例:
//   import { getAccount, getAllUserTweets, getProfileByScreenName, XSessionError } from "./libs/x-api/lib/index.mjs";

export { getAccount, loadAccounts, saveAccount, authHeaders, isSessionAlive, X_WEB_BEARER } from "../session.mjs";
export { xFetch } from "./http.mjs";
export { XSessionError, detectSessionError, formatSessionErrorForCLI } from "./errors.mjs";
export { getProfileByRestId, getProfileByScreenName, summarizeProfile } from "./profile.mjs";
export {
  fetchUserTweetsPage,
  extractTweetsAndCursor,
  getAllUserTweets,
} from "./user_tweets.mjs";
export { loginWithCredentials } from "./login.mjs";
export { reloginAccount, getCredentials } from "./auto_relogin.mjs";
export { saveData, parseSaveFlags, DEFAULT_DATA_DIR } from "./save.mjs";
export { sendDm, buildDmRequest, conversationId } from "./dm.mjs";
export { generateTransactionId } from "./transaction.mjs";
export { runCycle, findCandidates, defaultDeps } from "./autodm/cycle.mjs";
export { loadConfig, normalizeConfig, listConfigAccounts, configPath } from "./autodm/config.mjs";
export { matchKeyword, normalizeText } from "./autodm/keyword.mjs";
