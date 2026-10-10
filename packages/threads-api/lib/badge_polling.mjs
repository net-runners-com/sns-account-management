// Threads 通知バッジ監視 (Node-only, AVD 不要, 5秒レイテンシ)
//
// 戦略:
//   1. BarcelonaNotificationBadgeContextQueryDirectQuery を 5 秒間隔で polling
//      → 軽量 (response ~200B), CPU ~0
//   2. badge count 変化 (or activity tab last_seen 変化) 検知
//   3. activity feed (BarcelonaActivityFeedStoryListContainerQuery) を fetch
//   4. 前回見た event との diff を算出 → 新規 event を emit
import { EventEmitter } from "events";
import { callGraphQL } from "./graphql.mjs";
import { getActivityFeed, summarizeActivity } from "./activity.mjs";
import { listThreads } from "./dm_inbox.mjs";
import { getAccount } from "../session.mjs";
import { randomUUID } from "crypto";

export class BadgePollingBridge extends EventEmitter {
  constructor({ accountName, intervalMs = 5000, deviceId } = {}) {
    super();
    if (!accountName) throw new Error("accountName required");
    this.accountName = accountName;
    this.intervalMs = intervalMs;
    this.deviceId = deviceId || randomUUID().toUpperCase();
    this.timer = null;
    this.lastBadge = null;        // 直近 badge response (object)
    this.seenEventIds = new Set(); // 既に emit 済みの event 識別キー
    this.seenDMKeys = new Set();   // DM の重複防止
    this.firstDMRun = true;
    this.stopped = false;
  }

  async _fetchBadge() {
    const r = await callGraphQL({
      accountName: this.accountName,
      friendlyName: "BarcelonaNotificationBadgeContextQueryDirectQuery",
      variables: { deviceID: this.deviceId },
      referer: "https://www.threads.com/activity",
      crn: "comet.threads.BarcelonaActivityFeedColumnRoute",
      endpoint: "https://www.threads.com/graphql/query",
      skipJitter: true,
    });
    return r.json?.data?.xdt_text_app_notification_badge ?? null;
  }

  async _fetchActivity(first = 10) {
    const r = await getActivityFeed({ accountName: this.accountName, first });
    return summarizeActivity(r.json) || [];
  }

  _changed(prev, next) {
    if (!prev || !next) return prev !== next;
    return JSON.stringify(prev) !== JSON.stringify(next);
  }

  _eventKey(it) {
    return `${it.story_type}|${it.from_user_id}|${it.target_post_pk || ""}|${it.timestamp}`;
  }

  async _checkDMs() {
    try {
      // dummy env (cached session で動くので pwd 実値不要)
      process.env.THREADS_USERNAME = process.env.THREADS_USERNAME || "x";
      process.env.THREADS_PASSWORD = process.env.THREADS_PASSWORD || "x";
      const r = await listThreads({ account: this.accountName, amount: 10, threadsMode: false });
      // r は instagrapi が返す raw object. inbox.threads の形.
      const threads = r?.inbox?.threads || r?.threads || (Array.isArray(r) ? r : []);
      const acc = getAccount(this.accountName);
      // 自分発の DM 識別用 ID 集合 (Threads pk と IG pk が別なので両方必要)
      const myIds = new Set([acc.ds_user_id, acc.mobile_user_id].filter(Boolean));

      for (const t of threads) {
        const msgs = t.messages || [];
        if (!msgs.length) continue;
        const newest = msgs[0];
        const tid = String(t.pk || t.id || t.thread_id || t.thread_v2_id);
        const key = `dm|${tid}|${newest.id || newest.timestamp}`;

        // 初回は全 thread の最新 message を seen 扱い
        if (this.firstDMRun) {
          this.seenDMKeys.add(key);
          continue;
        }
        if (this.seenDMKeys.has(key)) continue;
        this.seenDMKeys.add(key);

        // 自分送信は skip
        if (newest.is_sent_by_viewer || myIds.has(String(newest.user_id))) continue;

        const sender = (t.users || []).find((u) => String(u.pk) === String(newest.user_id));
        const ts = newest.timestamp;
        let isoTs = ts;
        if (typeof ts === "string" && /\d{4}-\d{2}-\d{2}/.test(ts)) {
          isoTs = new Date(ts.replace(" ", "T") + "Z").toISOString();
        }
        this.emit("event", {
          type: "dm",
          story_type: null,
          icon_name: "msg",
          from_username: sender?.username || "unknown",
          from_user_id: String(newest.user_id),
          timestamp: isoTs,
          target_post_pk: null,
          target_post_code: null,
          content_preview: (newest.text || "(non-text)").slice(0, 200),
          thread_id: tid,
        });
      }
      if (this.firstDMRun) this.firstDMRun = false;
    } catch (e) {
      this.emit("error", new Error(`DM check: ${e.message}`));
    }
  }

  async _tick() {
    try {
      const badge = await this._fetchBadge();
      const badgeChanged = this._changed(this.lastBadge, badge);

      this._tickCount = (this._tickCount || 0) + 1;
      const forceCheck = this._tickCount % 5 === 0;
      const dmCheck = this._tickCount % 6 === 0;  // 30秒に 1 回 inbox poll

      this.emit("tick", { badge, changed: badgeChanged, forceCheck });

      if (badgeChanged || forceCheck) {
        const items = await this._fetchActivity(20);
        if (this.lastBadge === null && this.seenEventIds.size === 0) {
          for (const it of items) this.seenEventIds.add(this._eventKey(it));
        } else {
          for (const it of items.slice().reverse()) {
            const key = this._eventKey(it);
            if (this.seenEventIds.has(key)) continue;
            this.seenEventIds.add(key);
            this.emit("event", it);
          }
        }
        this.lastBadge = badge;
      }

      if (dmCheck) await this._checkDMs();
    } catch (e) {
      this.emit("error", e);
    }
  }

  _nextDelay() {
    // jitter ±30% で間隔ばらつかせる
    const jitter = (Math.random() - 0.5) * 0.6 * this.intervalMs;
    let d = Math.max(2000, this.intervalMs + jitter);
    // 429 backoff
    if (this.backoffUntil && Date.now() < this.backoffUntil) {
      d = Math.max(d, this.backoffUntil - Date.now());
    }
    // 休憩 window: 深夜 2-6 時 JST は 1分間隔に
    const h = new Date().getUTCHours() + 9; // JST
    const jst = h >= 24 ? h - 24 : h;
    if (jst >= 2 && jst < 6) d = Math.max(d, 60000);
    return d;
  }

  async _tickLoop() {
    if (this.stopped) return;
    try {
      await this._tick();
    } catch (e) {
      if (e.message?.includes("429") || e.message?.includes("rate limit")) {
        // 5分 backoff
        this.backoffUntil = Date.now() + 300000;
        this.emit("info", "rate limited → 5min backoff");
      }
    }
    if (this.stopped) return;
    setTimeout(() => this._tickLoop(), this._nextDelay());
  }

  async start() {
    this.emit("info", `polling badge every ~${this.intervalMs}ms (jittered ±30%)`);
    await this._tick();  // 初回 = baseline
    setTimeout(() => this._tickLoop(), this._nextDelay());
  }

  stop() {
    this.stopped = true;
  }
}
