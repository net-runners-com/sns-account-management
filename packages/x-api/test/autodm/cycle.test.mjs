import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findCandidates, runCycle, buildReplyQueries } from "../../lib/autodm/cycle.mjs";
import { emptyState, loadState } from "../../lib/autodm/state.mjs";
import { XSessionError } from "../../lib/errors.mjs";

const TRIG = { id: "t1", post_id: "100", keywords: ["特典"], dm_text: "DM本文", active: true };
const reply = (uid, text, postId = "100", id = `r${uid}`) => ({ id, text, in_reply_to_status_id: postId, user: { id: uid, screen_name: `u${uid}` } });

test("findCandidates: トリガー一致 + キーワード一致 + 自分除外 + 処理済み除外", () => {
  const state = emptyState();
  state.sent["100:3"] = {};
  state.pending["100:4"] = {};
  const replies = [
    reply("2", "特典ほしい"),
    reply("3", "特典ほしい"),          // sent 済
    reply("4", "特典ほしい"),          // pending 済
    reply("5", "こんにちは"),           // キーワード無し
    reply("6", "特典ほしい", "999"),   // 別投稿
    reply("1", "特典ほしい"),          // 自分
  ];
  const c = findCandidates({ replies, triggers: [TRIG], myUserId: "1", state });
  assert.deepEqual(c.map((x) => x.key), ["100:2"]);
  assert.equal(c[0].keyword, "特典");
  assert.equal(c[0].screen_name, "u2");
  assert.equal(c[0].reply_id, "r2");
  assert.equal(c[0].trigger.id, "t1");
});

test("findCandidates: active=false のトリガーは無視", () => {
  const c = findCandidates({ replies: [reply("2", "特典")], triggers: [{ ...TRIG, active: false }], myUserId: "1", state: emptyState() });
  assert.equal(c.length, 0);
});

// ---- runCycle harness ----
function harness({ config = { triggers: [TRIG] }, replies = [], follows = {}, sendImpl, profileImpl } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "autodm-cycle-"));
  const paths = { config: join(dir, "cfg.json"), state: join(dir, "state.json"), log: join(dir, "log.jsonl") };
  writeFileSync(paths.config, JSON.stringify(config));
  const calls = { sendDm: [], sleep: [], getProfile: [] };
  const deps = {
    getAccount: () => ({ user_id: "1", ct0: "c", auth_token: "a", cookies: "" }),
    getProfile: async (acc, { userId }) => {
      calls.getProfile.push(userId);
      if (profileImpl) return profileImpl(userId);
      if (userId === "1") return { user_id: "1", screen_name: "me", followed_by: false };
      return { user_id: userId, screen_name: `u${userId}`, followed_by: !!follows[userId] };
    },
    fetchReplies: async () => replies,
    sendDm: async (acc, args) => { calls.sendDm.push(args); if (sendImpl) return sendImpl(args); return { ok: true }; },
    sleep: async (ms) => { calls.sleep.push(ms); },
  };
  const logLines = () => (existsSync(paths.log) ? readFileSync(paths.log, "utf8").trim().split("\n").map(JSON.parse) : []);
  return { paths, deps, calls, logLines, run: (opts = {}) => runCycle({ accountName: "acc", deps, paths, ...opts }) };
}

test("runCycle: フォロワーのキーワードリプ → DM 送信 + state.sent + daily", async () => {
  const h = harness({ replies: [reply("2", "特典ください")], follows: { 2: true } });
  const s = await h.run();
  assert.equal(s.matched, 1);
  assert.equal(s.sent, 1);
  assert.equal(h.calls.sendDm.length, 1);
  // I3: requestId が追加されたので個別に確認 (uuid は毎回変わるので typeof のみ)
  assert.equal(h.calls.sendDm[0].recipientId, "2");
  assert.equal(h.calls.sendDm[0].text, "DM本文");
  assert.equal(h.calls.sendDm[0].accountName, "acc");
  assert.equal(typeof h.calls.sendDm[0].requestId, "string");
  assert.ok(h.calls.sendDm[0].requestId.length > 0);
  // I4: profile_delay_sec のジッタも sleep 経由になるので、DM ジッタ (30-90s) がちょうど1回であることを見る
  const dmSleeps = h.calls.sleep.filter((ms) => ms >= 30000 && ms <= 90000);
  const otherSleeps = h.calls.sleep.filter((ms) => ms < 30000 || ms > 90000);
  assert.equal(dmSleeps.length, 1);
  assert.ok(otherSleeps.every((ms) => ms >= 1000 && ms <= 3000));
  const st = loadState(h.paths.state);
  assert.ok(st.sent["100:2"]);
  assert.equal(st.pending["100:2"], undefined);
  assert.equal(Object.values(st.daily)[0], 1);
  assert.deepEqual(st.me, { user_id: "1", screen_name: "me" });
  // I7: サイクル末尾に cycle イベントが1回追加される
  assert.deepEqual(h.logLines().map((l) => l.event), ["matched", "sent", "cycle"]);
});

test("runCycle: 未フォローは pending、後でフォローしたら送る", async () => {
  const h = harness({ replies: [reply("2", "特典")], follows: {} });
  const s1 = await h.run();
  assert.equal(s1.pending, 1);
  assert.equal(h.calls.sendDm.length, 0);
  assert.ok(loadState(h.paths.state).pending["100:2"]);
  // 2周目: フォロー済みに (同じリプは再度 fetch されるが dedupe される)
  h.deps.getProfile = async (acc, { userId }) => ({ user_id: userId, screen_name: userId === "1" ? "me" : "u2", followed_by: userId !== "1" });
  const s2 = await h.run();
  assert.equal(s2.matched, 0);
  assert.equal(s2.sent, 1);
  assert.equal(h.calls.sendDm.length, 1);
});

test("runCycle: 同じリプで2周しても1通だけ", async () => {
  const h = harness({ replies: [reply("2", "特典")], follows: { 2: true } });
  await h.run();
  await h.run();
  assert.equal(h.calls.sendDm.length, 1);
});

test("runCycle: daily_cap で止まる", async () => {
  const h = harness({ config: { daily_cap: 1, triggers: [TRIG] }, replies: [reply("2", "特典"), reply("3", "特典")], follows: { 2: true, 3: true } });
  const s = await h.run();
  assert.equal(s.sent, 1);
  assert.equal(s.capReached, true);
  assert.equal(Object.keys(loadState(h.paths.state).pending).length, 1);
});

test("runCycle: dryRun は送らず pending のまま、dry_run イベントを記録", async () => {
  const h = harness({ replies: [reply("2", "特典")], follows: { 2: true } });
  const s = await h.run({ dryRun: true });
  assert.equal(s.sent, 0);
  assert.equal(h.calls.sendDm.length, 0);
  assert.ok(loadState(h.paths.state).pending["100:2"]);
  assert.ok(h.logLines().some((l) => l.event === "dry_run" && l.text === "DM本文"));
});

test("runCycle: DM 失敗 3 回で failed", async () => {
  const h = harness({ replies: [reply("2", "特典")], follows: { 2: true }, sendImpl: () => { throw new Error("boom"); } });
  await h.run(); await h.run();
  assert.equal(loadState(h.paths.state).pending["100:2"].attempts, 2);
  const s3 = await h.run();
  assert.equal(s3.failed, 1);
  const st = loadState(h.paths.state);
  assert.equal(st.pending["100:2"], undefined);
  assert.equal(st.failed["100:2"].attempts, 3);
  assert.equal(h.calls.sendDm.length, 3);
});

test("runCycle: 429 でサイクル中断 (残りは送らない, attempts は増やさず rate_limited_until を設定)", async () => {
  const h = harness({ replies: [reply("2", "特典"), reply("3", "特典")], follows: { 2: true, 3: true }, sendImpl: () => { const e = new Error("rate"); e.status = 429; throw e; } });
  const s = await h.run({ now: () => new Date("2026-08-31T12:00:00") });
  assert.equal(h.calls.sendDm.length, 1); // 2件目は試行されない
  assert.ok(h.logLines().some((l) => l.event === "rate_limited"));
  const st = loadState(h.paths.state);
  assert.equal(st.pending["100:2"].attempts, 0); // I2: 429 は attempts を増やさない
  assert.ok(st.rate_limited_until, "rate_limited_until が設定される");
  assert.equal(st.rate_limited_until, new Date(2026, 7, 32, 0, 0, 0).toISOString());
  assert.equal(s.sent, 0);
});

test("runCycle: rate_limited_until が有効な間は sendDm を1回も呼ばない", async () => {
  const h = harness({ config: { triggers: [TRIG] } });
  const st = emptyState();
  st.pending["100:2"] = { first_seen: "2026-08-30T00:00:00Z", screen_name: "u2", trigger: "t1", user_id: "2", post_id: "100", attempts: 0 };
  st.rate_limited_until = new Date(2026, 8, 1, 0, 0, 0).toISOString(); // 2026-09-01 00:00 local
  writeFileSync(h.paths.state, JSON.stringify(st));
  const s = await h.run({ now: () => new Date("2026-08-31T18:00:00") }); // まだ当日中
  assert.equal(h.calls.sendDm.length, 0);
  assert.equal(s.sent, 0);
  assert.equal(s.rateLimited, true);
  const lines = h.logLines();
  assert.ok(lines.some((l) => l.event === "rate_limited"));
  assert.equal(lines[lines.length - 1].event, "cycle"); // I7: cycle はサイクル末尾に必ず1回出る
  assert.ok(loadState(h.paths.state).pending["100:2"], "pending のまま残る");
});

test("runCycle: rate_limited_until を過ぎたら送信を再開する", async () => {
  const h = harness({ config: { triggers: [TRIG] }, follows: { 2: true } });
  const st = emptyState();
  st.pending["100:2"] = { first_seen: "2026-08-30T00:00:00Z", screen_name: "u2", trigger: "t1", user_id: "2", post_id: "100", attempts: 0 };
  st.rate_limited_until = new Date(2026, 8, 1, 0, 0, 0).toISOString(); // 2026-09-01 00:00 local
  writeFileSync(h.paths.state, JSON.stringify(st));
  const s = await h.run({ now: () => new Date("2026-09-01T00:00:01") }); // 過ぎている
  assert.equal(h.calls.sendDm.length, 1);
  assert.equal(s.sent, 1);
  assert.ok(loadState(h.paths.state).sent["100:2"]);
});

test("C1: 1件目の送信直後に state が永続化される (2件目の fake sendDm から読める)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "autodm-cycle-"));
  const paths = { config: join(dir, "cfg.json"), state: join(dir, "state.json"), log: join(dir, "log.jsonl") };
  writeFileSync(paths.config, JSON.stringify({ triggers: [TRIG] }));
  let sendCount = 0;
  let sawPersistedFirstSend = false;
  const deps = {
    getAccount: () => ({ user_id: "1", ct0: "c", auth_token: "a", cookies: "" }),
    getProfile: async (acc, { userId }) => userId === "1"
      ? { user_id: "1", screen_name: "me", followed_by: false }
      : { user_id: userId, screen_name: `u${userId}`, followed_by: true },
    fetchReplies: async () => [reply("2", "特典"), reply("3", "特典")],
    sendDm: async () => {
      sendCount++;
      if (sendCount === 2) {
        const st = loadState(paths.state);
        sawPersistedFirstSend = !!st.sent["100:2"];
      }
      return { ok: true };
    },
    sleep: async () => {},
  };
  const s = await runCycle({ accountName: "acc", deps, paths });
  assert.equal(s.sent, 2);
  assert.equal(sendCount, 2);
  assert.ok(sawPersistedFirstSend, "1件目の送信が2件目の前にディスクへ永続化されている");
});

test("I3: 送信失敗→再送で同じ request_id を使い回す (idempotent retry)", async () => {
  let calls = 0;
  const h = harness({
    replies: [reply("2", "特典")], follows: { 2: true },
    sendImpl: () => { calls++; if (calls === 1) throw new Error("boom"); return { ok: true }; },
  });
  await h.run();
  await h.run();
  assert.equal(h.calls.sendDm.length, 2);
  const [first, second] = h.calls.sendDm;
  assert.equal(typeof first.requestId, "string");
  assert.ok(first.requestId.length > 0);
  assert.equal(first.requestId, second.requestId);
});

test("I4: pending_check_limit で1サイクルのプロフィール再取得数を絞る (last_checked 昇順)", async () => {
  const h = harness({ config: { pending_check_limit: 1, triggers: [TRIG] } });
  const st = emptyState();
  const recent = new Date(Date.now() - 3600_000).toISOString(); // 1時間前 (pending_days 既定7日以内)
  st.pending["100:2"] = { first_seen: recent, screen_name: "u2", trigger: "t1", user_id: "2", post_id: "100", attempts: 0 };
  st.pending["100:3"] = { first_seen: recent, screen_name: "u3", trigger: "t1", user_id: "3", post_id: "100", attempts: 0 };
  writeFileSync(h.paths.state, JSON.stringify(st));
  h.deps.getProfile = async (acc, { userId }) => {
    h.calls.getProfile.push(userId);
    return userId === "1"
      ? { user_id: "1", screen_name: "me", followed_by: false }
      : { user_id: userId, screen_name: `u${userId}`, followed_by: false };
  };
  await h.run();
  const nonOwn1 = h.calls.getProfile.filter((u) => u !== "1");
  assert.equal(nonOwn1.length, 1);
  assert.equal(nonOwn1[0], "2");
  const st1 = loadState(h.paths.state);
  assert.ok(st1.pending["100:2"].last_checked, "取得したエントリに last_checked が付く");
  assert.equal(st1.pending["100:3"].last_checked, undefined, "取得しなかったエントリは last_checked が付かない");

  await h.run();
  const nonOwn2 = h.calls.getProfile.filter((u) => u !== "1").slice(nonOwn1.length);
  assert.equal(nonOwn2.length, 1);
  assert.equal(nonOwn2[0], "3", "2周目は last_checked が無い方 (もう1件) を取得する");
});

test("I5: プロフィール取得が1件だけ失敗しても他の pending は処理を続ける", async () => {
  const h = harness({
    replies: [reply("2", "特典"), reply("3", "特典")],
    profileImpl: (userId) => {
      if (userId === "1") return { user_id: "1", screen_name: "me", followed_by: false };
      if (userId === "2") throw new Error("boom");
      return { user_id: userId, screen_name: `u${userId}`, followed_by: true };
    },
  });
  const s = await h.run();
  assert.equal(s.sent, 1, "user3 はそのまま送信される");
  assert.ok(h.logLines().some((l) => l.event === "profile_failed" && l.key === "100:2"));
  const st = loadState(h.paths.state);
  assert.ok(st.pending["100:2"], "user2 は次サイクルで再試行するため pending のまま残る");
  assert.ok(st.sent["100:3"]);
});

test("M1: deps 省略時は defaultDeps() が使われる (active トリガー無しなら呼ばれずに終わる)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "autodm-cycle-"));
  const paths = { config: join(dir, "cfg.json"), state: join(dir, "state.json"), log: join(dir, "log.jsonl") };
  writeFileSync(paths.config, JSON.stringify({ triggers: [{ ...TRIG, active: false }] }));
  const s = await runCycle({ accountName: "acc", paths });
  assert.equal(s.matched, 0);
});

test("runCycle: XSessionError は throw せず summary.sessionError + state 保存", async () => {
  const h = harness({ profileImpl: () => { throw new XSessionError("expired", { status: 401, accountName: "acc" }); } });
  const s = await h.run();
  assert.equal(s.sessionError, "expired");
  assert.ok(existsSync(h.paths.state));
  assert.ok(h.logLines().some((l) => l.event === "session_error"));
});

test("runCycle: pending_days 超過は expired", async () => {
  const h = harness({ config: { pending_days: 7, triggers: [TRIG] } });
  const st = emptyState();
  st.pending["100:9"] = { first_seen: "2026-08-01T00:00:00Z", screen_name: "u9", trigger: "t1", user_id: "9", post_id: "100", attempts: 0 };
  writeFileSync(h.paths.state, JSON.stringify(st));
  const s = await h.run({ now: () => new Date("2026-08-31T00:00:00Z") });
  assert.equal(s.expired, 1);
  assert.ok(loadState(h.paths.state).expired["100:9"]);
  assert.equal(h.calls.getProfile.filter((u) => u === "9").length, 0);
});

test("runCycle: active トリガーが無ければ何もしない", async () => {
  const h = harness({ config: { triggers: [{ ...TRIG, active: false }] }, replies: [reply("2", "特典")], follows: { 2: true } });
  const s = await h.run();
  assert.equal(s.matched, 0);
  assert.equal(h.calls.getProfile.length, 0);
});

test("buildReplyQueries: to:me + 各トリガーの conversation_id を返す", () => {
  const q = buildReplyQueries({ screenName: "me", postIds: ["100", "200"] });
  assert.deepEqual(q, [
    "to:me -from:me",
    "conversation_id:100 -from:me",
    "conversation_id:200 -from:me",
  ]);
});

test("buildReplyQueries: postIds 空なら to:me のみ / falsy な id は除外", () => {
  assert.deepEqual(buildReplyQueries({ screenName: "me" }), ["to:me -from:me"]);
  assert.deepEqual(buildReplyQueries({ screenName: "me", postIds: ["", null, "300"] }), ["to:me -from:me", "conversation_id:300 -from:me"]);
});
