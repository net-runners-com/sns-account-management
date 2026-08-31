import { test } from "node:test";
import assert from "node:assert/strict";
import { extractFromTimeline } from "../lib/search.mjs";
import { summarizeProfile } from "../lib/profile.mjs";

function timelineWith(tweetResult) {
  return {
    data: { search_by_raw_query: { search_timeline: { timeline: { instructions: [
      { entries: [ { content: { entryType: "TimelineTimelineItem", itemContent: { itemType: "TimelineTweet", tweet_results: { result: tweetResult } } } } ] },
    ] } } } },
  };
}

test("search: reply 先の id / user_id / screen_name を拾う", () => {
  const json = timelineWith({
    rest_id: "900",
    legacy: {
      full_text: "特典ください",
      in_reply_to_status_id_str: "100",
      in_reply_to_user_id_str: "1",
      in_reply_to_screen_name: "me",
    },
    core: { user_results: { result: { rest_id: "42", core: { screen_name: "fan" } } } },
  });
  const { tweets } = extractFromTimeline(json);
  assert.equal(tweets.length, 1);
  assert.equal(tweets[0].id, "900");
  assert.equal(tweets[0].is_reply, true);
  assert.equal(tweets[0].in_reply_to_status_id, "100");
  assert.equal(tweets[0].in_reply_to_user_id, "1");
  assert.equal(tweets[0].in_reply_to_screen_name, "me");
  assert.equal(tweets[0].user.id, "42");
});

test("search: reply でない時は null", () => {
  const { tweets } = extractFromTimeline(timelineWith({ rest_id: "1", legacy: { full_text: "x" }, core: { user_results: { result: { rest_id: "2", core: { screen_name: "a" } } } } }));
  assert.equal(tweets[0].in_reply_to_status_id, null);
  assert.equal(tweets[0].in_reply_to_user_id, null);
  assert.equal(tweets[0].in_reply_to_screen_name, null);
});

test("profile: relationship_perspectives 優先で followed_by / following", () => {
  const p = summarizeProfile({ data: { user: { result: {
    rest_id: "42", core: { screen_name: "fan" },
    legacy: { followed_by: false, following: false },
    relationship_perspectives: { followed_by: true, following: false },
  } } } });
  assert.equal(p.followed_by, true);
  assert.equal(p.following, false);
});

test("profile: legacy.followed_by にフォールバック / 無ければ false", () => {
  const p1 = summarizeProfile({ data: { user: { result: { rest_id: "1", core: { screen_name: "a" }, legacy: { followed_by: true } } } } });
  assert.equal(p1.followed_by, true);
  const p2 = summarizeProfile({ data: { user: { result: { rest_id: "1", core: { screen_name: "a" }, legacy: {} } } } });
  assert.equal(p2.followed_by, false);
  assert.equal(p2.following, false);
});
