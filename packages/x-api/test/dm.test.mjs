import { test } from "node:test";
import assert from "node:assert/strict";
import { conversationId, buildDmRequest, DM_PATH } from "../lib/dm.mjs";

test("conversationId: 数値として小さい方が先 (文字列比較ではない)", () => {
  assert.equal(conversationId("10", "9"), "9-10");
  assert.equal(conversationId("9", "10"), "9-10");
  assert.equal(conversationId("1234567890123456789", "99"), "99-1234567890123456789");
});

test("buildDmRequest: url と body", () => {
  const { url, body } = buildDmRequest({ myUserId: "1", recipientId: "2", text: "hello", requestId: "req-1" });
  assert.ok(url.startsWith("https://x.com" + DM_PATH + "?"));
  assert.match(url, /ext=/);
  assert.deepEqual(body, {
    conversation_id: "1-2",
    recipient_ids: false,
    request_id: "req-1",
    text: "hello",
    cards_platform: "Web-12",
    include_cards: 1,
    include_quote_count: true,
    dm_users: false,
  });
});

test("buildDmRequest: requestId 省略で uuid が入る / 必須引数チェック", () => {
  const { body } = buildDmRequest({ myUserId: "1", recipientId: "2", text: "x" });
  assert.match(body.request_id, /^[0-9a-f-]{36}$/);
  assert.throws(() => buildDmRequest({ recipientId: "2", text: "x" }), /myUserId/);
  assert.throws(() => buildDmRequest({ myUserId: "1", text: "x" }), /recipientId/);
  assert.throws(() => buildDmRequest({ myUserId: "1", recipientId: "2", text: "" }), /text/);
});
