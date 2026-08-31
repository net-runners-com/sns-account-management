// autodm 1サイクル: 自分宛リプ取得 → トリガー/キーワード照合 → フォロー判定 → DM 送信 → state 保存.
// ネットワークは deps に注入する (テストは fake deps).
import { matchKeyword } from "./keyword.mjs";
import {
  candidateKey, dailyCount, bumpDaily, expirePending,
  loadState, saveState, statePath, logPath, appendLog,
} from "./state.mjs";
import { loadConfig, configPath } from "./config.mjs";
import { XSessionError } from "../errors.mjs";
import { getAccount } from "../../session.mjs";
import { getProfileByRestId } from "../profile.mjs";
import { searchAll } from "../search.mjs";
import { sendDm } from "../dm.mjs";

export const MAX_DM_ATTEMPTS = 3;

export function jitterMs([min, max]) {
  return Math.round((min + Math.random() * (max - min)) * 1000);
}

/**
 * リプ一覧から新規候補を抽出する純関数.
 * @returns {{ key, trigger, user_id, screen_name, reply_id, keyword }[]}
 */
export function findCandidates({ replies, triggers, myUserId, state }) {
  const byPost = new Map(triggers.filter((t) => t.active).map((t) => [t.post_id, t]));
  const out = [];
  for (const r of replies || []) {
    const trig = byPost.get(String(r.in_reply_to_status_id));
    if (!trig) continue;
    const uid = r.user?.id;
    if (!uid || String(uid) === String(myUserId)) continue;
    const key = candidateKey(trig.post_id, uid);
    if (state.sent[key] || state.failed[key] || state.expired[key] || state.pending[key]) continue;
    const keyword = matchKeyword(r.text, trig.keywords);
    if (!keyword) continue;
    out.push({ key, trigger: trig, user_id: String(uid), screen_name: r.user.screen_name, reply_id: r.id, keyword });
  }
  return out;
}

export function defaultDeps() {
  return {
    getAccount,
    getProfile: (acc, opts) => getProfileByRestId(acc, opts),
    fetchReplies: async (acc, { screenName, maxPages, accountName }) => {
      const { tweets } = await searchAll(acc, {
        rawQuery: `to:${screenName} -from:${screenName}`,
        product: "Latest",
        max: maxPages * 20,
        perPage: 20,
        accountName,
      });
      return tweets;
    },
    sendDm,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    log: (e) => {
      const who = e.screen_name ? ` @${e.screen_name}` : "";
      console.error(`[autodm] ${e.account} ${e.event}${who}${e.error ? ` ${e.error}` : ""}`);
    },
  };
}

/**
 * 1アカウント 1サイクル.
 * @returns {Promise<{matched, pending, sent, failed, expired, capReached, sessionError?}>}
 */
export async function runCycle({ accountName, dryRun = false, deps, paths = {}, now = () => new Date() }) {
  const { getAccount, getProfile, fetchReplies, sendDm, sleep, log } = deps;
  const cfgPath = paths.config || configPath(accountName);
  const stPath = paths.state || statePath(accountName);
  const lgPath = paths.log || logPath(accountName);

  const config = loadConfig(cfgPath);
  const state = loadState(stPath);
  const summary = { matched: 0, pending: 0, sent: 0, failed: 0, expired: 0, capReached: false };
  const emit = (event, extra = {}) => {
    const e = { account: accountName, event, ...extra };
    appendLog(lgPath, e);
    if (log) log(e);
  };

  const active = config.triggers.filter((t) => t.active);
  if (active.length === 0) return summary;

  try {
    const acc = getAccount(accountName);
    const me = await getProfile(acc, { userId: acc.user_id, accountName });
    if (!me?.screen_name) throw new Error("own profile fetch failed (screen_name missing)");
    state.me = { user_id: String(me.user_id), screen_name: me.screen_name };

    // 1. 期限切れ
    for (const key of expirePending(state, config.pending_days, now())) {
      summary.expired++;
      emit("expired", { key });
    }

    // 2. 新規候補 → pending
    const replies = await fetchReplies(acc, { screenName: me.screen_name, maxPages: config.search_max_pages, accountName });
    for (const c of findCandidates({ replies, triggers: active, myUserId: state.me.user_id, state })) {
      summary.matched++;
      state.pending[c.key] = {
        first_seen: now().toISOString(), screen_name: c.screen_name, reply_id: c.reply_id,
        trigger: c.trigger.id, user_id: c.user_id, post_id: c.trigger.post_id, attempts: 0,
      };
      emit("matched", { key: c.key, trigger: c.trigger.id, post_id: c.trigger.post_id, user_id: c.user_id, screen_name: c.screen_name, keyword: c.keyword });
    }

    // 3. pending を処理: フォロー判定 → 送信
    const trigById = new Map(config.triggers.map((t) => [t.id, t]));
    for (const [key, p] of Object.entries(state.pending)) {
      const trig = trigById.get(p.trigger);
      if (!trig || !trig.active) continue;
      if (dailyCount(state, now()) >= config.daily_cap) {
        summary.capReached = true;
        emit("cap_reached", { daily_cap: config.daily_cap });
        break;
      }
      const prof = await getProfile(acc, { userId: p.user_id, accountName });
      if (!prof?.followed_by) { summary.pending++; continue; }
      if (dryRun) {
        emit("dry_run", { key, screen_name: p.screen_name, trigger: trig.id, text: trig.dm_text });
        continue;
      }
      try {
        await sleep(jitterMs(config.dm_delay_sec));
        await sendDm(acc, { recipientId: p.user_id, text: trig.dm_text, accountName });
        state.sent[key] = { at: now().toISOString(), screen_name: p.screen_name, trigger: trig.id, user_id: p.user_id, post_id: p.post_id };
        delete state.pending[key];
        bumpDaily(state, now());
        summary.sent++;
        emit("sent", { key, screen_name: p.screen_name, trigger: trig.id });
      } catch (e) {
        if (e instanceof XSessionError) throw e;
        p.attempts = (p.attempts || 0) + 1;
        p.last_error = String(e.message);
        emit("dm_failed", { key, screen_name: p.screen_name, attempts: p.attempts, error: e.message });
        if (p.attempts >= MAX_DM_ATTEMPTS) {
          state.failed[key] = { at: now().toISOString(), attempts: p.attempts, error: e.message, screen_name: p.screen_name, trigger: trig.id };
          delete state.pending[key];
          summary.failed++;
        }
        if (e.status === 429) {
          emit("rate_limited", { key });
          break;
        }
      }
    }
  } catch (e) {
    if (e instanceof XSessionError) {
      summary.sessionError = e.message;
      emit("session_error", { error: e.message });
    } else {
      throw e;
    }
  } finally {
    saveState(stPath, state);
  }
  return summary;
}
