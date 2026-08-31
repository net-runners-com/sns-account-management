import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findCandidates, runCycle } from "../../lib/autodm/cycle.mjs";
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
  assert.deepEqual(h.calls.sendDm[0], { recipientId: "2", text: "DM本文", accountName: "acc" });
  assert.equal(h.calls.sleep.length, 1);
  assert.ok(h.calls.sleep[0] >= 30000 && h.calls.sleep[0] <= 90000);
  const st = loadState(h.paths.state);
  assert.ok(st.sent["100:2"]);
  assert.equal(st.pending["100:2"], undefined);
  assert.equal(Object.values(st.daily)[0], 1);
  assert.deepEqual(st.me, { user_id: "1", screen_name: "me" });
  assert.deepEqual(h.logLines().map((l) => l.event), ["matched", "sent"]);
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

test("runCycle: 429 でサイクル中断 (残りは送らない)", async () => {
  const h = harness({ replies: [reply("2", "特典"), reply("3", "特典")], follows: { 2: true, 3: true }, sendImpl: () => { const e = new Error("rate"); e.status = 429; throw e; } });
  await h.run();
  assert.equal(h.calls.sendDm.length, 1);
  assert.ok(h.logLines().some((l) => l.event === "rate_limited"));
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
