// autodm 1サイクル: 自分宛リプ取得 → トリガー/キーワード照合 → フォロー判定 → DM 送信 → state 保存.
// ネットワークは deps に注入する (テストは fake deps).
import { randomUUID } from "node:crypto";
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

/** pending を last_checked 昇順 ([key, entry] の配列。未設定は先頭) に並べる */
function sortPendingByLastChecked(pending) {
  const lc = (p) => p.last_checked || "";
  return Object.entries(pending).sort((a, b) => {
    const la = lc(a[1]), lb = lc(b[1]);
    return la < lb ? -1 : la > lb ? 1 : 0;
  });
}

/**
 * 1アカウント 1サイクル.
 * @returns {Promise<{matched, pending, sent, failed, expired, capReached, sessionError?}>}
 */
export async function runCycle({ accountName, dryRun = false, deps = defaultDeps(), paths = {}, now = () => new Date() }) {
  const { getAccount, getProfile, fetchReplies, sendDm, sleep, log } = deps;
  const cfgPath = paths.config || configPath(accountName);
  const stPath = paths.state || statePath(accountName);
  const lgPath = paths.log || logPath(accountName);

  const config = loadConfig(cfgPath);
  const state = loadState(stPath);
  const summary = { matched: 0, pending: 0, sent: 0, failed: 0, expired: 0, capReached: false, replies_fetched: 0 };
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
    summary.replies_fetched = replies.length;
    for (const c of findCandidates({ replies, triggers: active, myUserId: state.me.user_id, state })) {
      summary.matched++;
      state.pending[c.key] = {
        first_seen: now().toISOString(), screen_name: c.screen_name, reply_id: c.reply_id,
        trigger: c.trigger.id, user_id: c.user_id, post_id: c.trigger.post_id, attempts: 0,
      };
      emit("matched", { key: c.key, trigger: c.trigger.id, post_id: c.trigger.post_id, user_id: c.user_id, screen_name: c.screen_name, keyword: c.keyword });
    }
    saveState(stPath, state); // C1: マッチ直後に永続化 (この後の送信中に落ちても matched→pending が残る)

    // 3. pending を処理: フォロー判定 → 送信
    const trigById = new Map(config.triggers.map((t) => [t.id, t]));
    const pendingEntries = sortPendingByLastChecked(state.pending);
    let profileFetchCount = 0;
    for (const [key, p] of pendingEntries) {
      // I2: 前サイクルの 429 でまだ「当日の残り」を止めている
      if (state.rate_limited_until && now() < new Date(state.rate_limited_until)) {
        emit("rate_limited", { until: state.rate_limited_until });
        summary.rateLimited = true;
        break;
      }
      const trig = trigById.get(p.trigger);
      if (!trig || !trig.active) continue;
      if (dailyCount(state, now()) >= config.daily_cap) {
        summary.capReached = true;
        emit("cap_reached", { daily_cap: config.daily_cap });
        break;
      }
      // I4: 1サイクルで再判定するプロフィール取得数を絞る (古い last_checked から優先)
      if (profileFetchCount >= config.pending_check_limit) break;
      if (profileFetchCount > 0) await sleep(jitterMs(config.profile_delay_sec));
      profileFetchCount++;
      let prof;
      try {
        prof = await getProfile(acc, { userId: p.user_id, accountName });
      } catch (e) {
        // I5: このエントリだけスキップして次へ (state は変更しない = 次サイクルで再試行)
        if (e instanceof XSessionError) throw e;
        p.last_checked = now().toISOString();
        emit("profile_failed", { key, screen_name: p.screen_name, error: e.message });
        continue;
      }
      p.last_checked = now().toISOString();
      if (!prof?.followed_by) { summary.pending++; continue; }
      if (dryRun) {
        emit("dry_run", { key, screen_name: p.screen_name, trigger: trig.id, text: trig.dm_text });
        continue;
      }
      // I3: request_id を pending に永続化し、再送でも同じ id を使う (X 側の二重送信防止)
      if (!p.request_id) p.request_id = randomUUID();
      try {
        await sleep(jitterMs(config.dm_delay_sec));
        await sendDm(acc, { recipientId: p.user_id, text: trig.dm_text, accountName, requestId: p.request_id });
        state.sent[key] = { at: now().toISOString(), screen_name: p.screen_name, trigger: trig.id, user_id: p.user_id, post_id: p.post_id };
        delete state.pending[key];
        bumpDaily(state, now());
        saveState(stPath, state); // C1: 送信成功のたびに永続化 (次の送信前に必ずディスクへ)
        summary.sent++;
        emit("sent", { key, screen_name: p.screen_name, trigger: trig.id });
      } catch (e) {
        if (e instanceof XSessionError) throw e;
        // I2: 429 は当日の残りを送らない。attempts は増やさない (再送で無駄打ちしない)
        if (e.status === 429) {
          const d = now();
          state.rate_limited_until = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).toISOString();
          emit("rate_limited", { key, until: state.rate_limited_until });
          break;
        }
        p.attempts = (p.attempts || 0) + 1;
        p.last_error = String(e.message);
        emit("dm_failed", { key, screen_name: p.screen_name, attempts: p.attempts, error: e.message });
        if (p.attempts >= MAX_DM_ATTEMPTS) {
          state.failed[key] = { at: now().toISOString(), attempts: p.attempts, error: e.message, screen_name: p.screen_name, trigger: trig.id };
          delete state.pending[key];
          summary.failed++;
        }
      }
    }

    // I7: 検索窓の取りこぼし/飽和を見える化するサイクル要約イベント (fetch 段階まで到達した時だけ)
    emit("cycle", {
      replies_fetched: summary.replies_fetched,
      matched: summary.matched,
      pending: summary.pending,
      sent: summary.sent,
      failed: summary.failed,
      expired: summary.expired,
    });
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
