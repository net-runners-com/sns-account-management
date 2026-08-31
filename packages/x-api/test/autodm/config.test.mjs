import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  normalizeConfig, loadConfig, configPath, listConfigAccounts, DEFAULTS,
} from "../../lib/autodm/config.mjs";

const trig = { post_id: 123, keywords: ["特典"], dm_text: "hi" };

test("normalizeConfig: デフォルト適用 + id/active 補完 + post_id 文字列化", () => {
  const c = normalizeConfig({ triggers: [trig] });
  assert.equal(c.daily_cap, DEFAULTS.daily_cap);
  assert.equal(c.poll_interval_sec, DEFAULTS.poll_interval_sec);
  assert.equal(c.pending_days, 7);
  assert.deepEqual(c.dm_delay_sec, [30, 90]);
  assert.equal(c.search_max_pages, 3);
  assert.deepEqual(c.triggers[0], { id: "trigger-0", post_id: "123", keywords: ["特典"], dm_text: "hi", active: true });
});

test("normalizeConfig: クランプ (poll>=300, cap<=500, dm_delay_sec 不正はデフォルト)", () => {
  const c = normalizeConfig({ poll_interval_sec: 10, daily_cap: 9999, dm_delay_sec: [5], triggers: [trig] });
  assert.equal(c.poll_interval_sec, 300);
  assert.equal(c.daily_cap, 500);
  assert.deepEqual(c.dm_delay_sec, [30, 90]);
});

test("normalizeConfig: 検証エラー", () => {
  assert.throws(() => normalizeConfig({}), /triggers/);
  assert.throws(() => normalizeConfig({ triggers: [{ keywords: ["a"], dm_text: "x" }] }), /post_id/);
  assert.throws(() => normalizeConfig({ triggers: [{ post_id: "1", keywords: [], dm_text: "x" }] }), /keywords/);
  assert.throws(() => normalizeConfig({ triggers: [{ post_id: "1", keywords: ["a"] }] }), /dm_text/);
});

test("loadConfig / configPath / listConfigAccounts", () => {
  const dir = mkdtempSync(join(tmpdir(), "autodm-cfg-"));
  writeFileSync(join(dir, "acc_a.json"), JSON.stringify({ triggers: [trig] }));
  writeFileSync(join(dir, "acc_b.json"), JSON.stringify({ triggers: [trig] }));
  writeFileSync(join(dir, "example.json"), JSON.stringify({ triggers: [trig] }));
  writeFileSync(join(dir, "README.md"), "x");
  assert.equal(configPath("acc_a", dir), join(dir, "acc_a.json"));
  assert.deepEqual(listConfigAccounts(dir), ["acc_a", "acc_b"]);
  assert.equal(loadConfig(configPath("acc_a", dir)).triggers[0].post_id, "123");
  assert.throws(() => loadConfig(join(dir, "nope.json")), /not found/);
});
