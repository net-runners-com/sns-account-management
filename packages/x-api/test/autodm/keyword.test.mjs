import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeText, matchKeyword } from "../../lib/autodm/keyword.mjs";

test("normalizeText: NFKC + lowercase + 空白除去", () => {
  assert.equal(normalizeText("Ｔｏｋｕｔｅｎ　ＡＢＣ "), "tokutenabc");
  assert.equal(normalizeText(null), "");
});

test("matchKeyword: 全角/大小/空白の違いを無視して一致", () => {
  assert.equal(matchKeyword("特典 ください！", ["特典"]), "特典");
  assert.equal(matchKeyword("ＴＯＫＵＴＥＮ", ["tokuten"]), "tokuten");
  assert.equal(matchKeyword("特 典", ["特典"]), "特典");
});

test("matchKeyword: 複数キーワードは最初に一致したものを返す", () => {
  assert.equal(matchKeyword("プレゼントと特典", ["特典", "プレゼント"]), "特典");
});

test("matchKeyword: 不一致 / 空キーワード / 空配列は null", () => {
  assert.equal(matchKeyword("こんにちは", ["特典"]), null);
  assert.equal(matchKeyword("こんにちは", [""]), null);
  assert.equal(matchKeyword("こんにちは", []), null);
  assert.equal(matchKeyword("こんにちは", undefined), null);
});
