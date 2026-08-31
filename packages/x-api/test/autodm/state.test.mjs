import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  statePath, logPath, emptyState, loadState, saveState, candidateKey,
  dayKey, dailyCount, bumpDaily, expirePending, appendLog,
} from "../../lib/autodm/state.mjs";

const tmp = () => mkdtempSync(join(tmpdir(), "autodm-"));

test("statePath / logPath はアカウント配下", () => {
  assert.equal(statePath("acc1", "/d"), join("/d", "acc1", "autodm_state.json"));
  assert.equal(logPath("acc1", "/d"), join("/d", "acc1", "autodm_log.jsonl"));
});

test("emptyState: rate_limited_until を null で持つ", () => {
  assert.equal(emptyState().rate_limited_until, null);
});

test("loadState: 無ければ emptyState、あれば round-trip", () => {
  const p = join(tmp(), "s.json");
  assert.deepEqual(loadState(p), emptyState());
  const st = emptyState();
  st.sent["1:2"] = { at: "2026-08-31T00:00:00.000Z" };
  saveState(p, st);
  assert.deepEqual(loadState(p), st);
  assert.equal(existsSync(p + `.${process.pid}.tmp`), false, "tmp ファイルが残らない");
});

test("candidateKey / dayKey / daily カウント", () => {
  assert.equal(candidateKey("100", "200"), "100:200");
  const now = new Date(2026, 7, 31, 23, 30); // ローカル 2026-08-31
  assert.equal(dayKey(now), "2026-08-31");
  const st = emptyState();
  assert.equal(dailyCount(st, now), 0);
  bumpDaily(st, now); bumpDaily(st, now);
  assert.equal(dailyCount(st, now), 2);
  assert.equal(dailyCount(st, new Date(2026, 8, 1)), 0);
});

test("expirePending: pendingDays を超えたものだけ expired へ", () => {
  const now = new Date("2026-08-31T00:00:00Z");
  const st = emptyState();
  st.pending["p:old"] = { first_seen: "2026-08-20T00:00:00Z", screen_name: "old", trigger: "t" };
  st.pending["p:new"] = { first_seen: "2026-08-30T00:00:00Z", screen_name: "new", trigger: "t" };
  const moved = expirePending(st, 7, now);
  assert.deepEqual(moved, ["p:old"]);
  assert.equal(st.pending["p:old"], undefined);
  assert.equal(st.expired["p:old"].screen_name, "old");
  assert.ok(st.pending["p:new"]);
});

test("appendLog: 1行1JSON、ts 付き", () => {
  const p = join(tmp(), "sub", "log.jsonl");
  appendLog(p, { event: "a" });
  appendLog(p, { event: "b", n: 1 });
  const lines = readFileSync(p, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(lines.length, 2);
  assert.equal(lines[1].event, "b");
  assert.equal(lines[1].n, 1);
  assert.match(lines[0].ts, /^\d{4}-\d{2}-\d{2}T/);
});
