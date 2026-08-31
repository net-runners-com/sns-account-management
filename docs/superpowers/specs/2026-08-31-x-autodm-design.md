# X キーワード自動DM（x-autodm）設計

日付: 2026-08-31 / 対象: `packages/x-api/` / 状態: 設計承認済（チャット）

## 目的

X の自分の投稿に「キーワード」を含むリプライをした人へ、自動でDMを送る。
3アカウント（いずれも非Premium）で運用する。

## 前提（Xの制約）

- 非Premiumアカウントは **相手が自分をフォローしている時だけ** DMを送れる。
- X の DM 上限は 500通/日/アカウント。本システムはデフォルト 50通/日に抑える。
- 非公式 Web 内部エンドポイントを使う（公式APIは従量課金）。凍結リスクはゼロにならないため、
  ポーリング間隔・送信ジッタ・日次上限で抑制する。催促リプ等の自動書き込みはDM以外行わない。

## 非目標

- 催促リプライの自動送信 / 未フォロー者へのDM（不可能） / 画像付きDM / 公式API対応
- 投稿自体の自動作成（既存フローで手動投稿し、その post_id を設定に書く）

## アーキテクチャ

```
autodm/<account>.json (設定)        data/<account>/autodm_state.json (状態)
        │                                     ▲
        ▼                                     │
autodm.mjs (CLI) ──▶ lib/autodm/cycle.mjs ┬▶ lib/search.mjs   searchAll("to:<me> -from:<me>", Latest)
                       (1サイクル)   ├─▶ lib/profile.mjs  followed_by 判定
                                     ├─▶ lib/dm.mjs       sendDm()
                                     └─▶ data/<account>/autodm_log.jsonl (追記ログ)
```

### 1サイクル（アカウント単位）

1. 設定読込。`active: true` のトリガーが無ければ終了。
2. `searchAll(acc, { query: "to:<me> -from:<me>", product: "Latest", maxPages })` で自分宛リプを取得。
3. 各リプについて: `in_reply_to_status_id` がトリガーの `post_id` に一致 かつ
   本文正規化（NFKC → 小文字 → 空白除去）後に `keywords` のいずれかを含む → 候補。
4. `key = "<post_id>:<user_id>"` が state の `sent` / `failed` にあれば除外。
5. フォロー判定: `getProfileByRestId` → `followed_by`。
   - 未フォロー → `pending[key]`（`first_seen` 記録）。`pending_days` 経過で `expired` に移す。
   - フォロー済 → 送信キューへ。既存 `pending` も毎サイクル再判定する。
6. 送信: 当日カウントが `daily_cap` 未満の間、`dm_delay_sec` の範囲のランダム待機を挟んで `sendDm`。
   成功 → `sent[key]`。失敗 → `attempts` を増やし、3回で `failed[key]`。
7. state を書き戻し、各イベントを jsonl に追記。

### 複数アカウント

`--all` で `autodm/*.json` を順に処理する（並列にしない）。1アカウントの `XSessionError` は
ログして次のアカウントへ進む（ループ全体は落とさない）。

## ファイル

| パス | 役割 |
|---|---|
| `lib/dm.mjs` | `sendDm(acc, { recipientId, text, accountName })`。`POST /i/api/1.1/dm/new2.json`（要検証・下記） |
| `lib/autodm/{keyword,state,config,cycle}.mjs` | 純関数中心に分割: 照合 / state+jsonl / 設定 / 1サイクル本体 `runCycle({ accountName, dryRun, deps })`（ネットワークは deps 注入） |
| `lib/transaction.mjs` | `x-client-transaction-id` 生成の共有シングルトン（新規コード用） |
| `autodm.mjs` | CLI。`--account <name>` \| `--all`、`--once`（既定）\| `--loop`、`--dry-run`、`--interval <sec>` |
| `lib/profile.mjs` | Profile に `followed_by` / `following` を追加 |
| `lib/search.mjs` | Item に `in_reply_to_status_id` / `in_reply_to_screen_name` を追加 |
| `autodm/<account>.json` | 設定（下記） |
| `autodm/example.json` | 設定の雛形 |
| `data/<account>/autodm_state.json` | 状態（gitignore 対象） |
| `data/<account>/autodm_log.jsonl` | イベントログ（gitignore 対象） |
| `docs/autodm.md` | 運用手順（設定・起動・launchd 例・トラブル対処） |

## データ形式

設定 `autodm/<account>.json`:

```json
{
  "daily_cap": 50,
  "poll_interval_sec": 600,
  "pending_days": 7,
  "dm_delay_sec": [30, 90],
  "search_max_pages": 3,
  "triggers": [
    { "id": "campaign-a", "post_id": "1234567890", "keywords": ["特典"], "dm_text": "…", "active": true }
  ]
}
```

状態 `data/<account>/autodm_state.json`:

```json
{
  "sent":    { "<post_id>:<user_id>": { "at": "ISO", "screen_name": "…", "trigger": "campaign-a" } },
  "pending": { "<post_id>:<user_id>": { "first_seen": "ISO", "screen_name": "…", "reply_id": "…", "trigger": "…" } },
  "failed":  { "<post_id>:<user_id>": { "at": "ISO", "attempts": 3, "error": "…" } },
  "expired": { "<post_id>:<user_id>": { "at": "ISO" } },
  "daily":   { "YYYY-MM-DD": 12 }
}
```

ログ `autodm_log.jsonl`（1行1イベント）: `{ ts, account, event, trigger, post_id, user_id, screen_name, detail }`
event ∈ `matched | sent | dry_run | dm_failed | rate_limited | cap_reached | expired | session_error`
（未フォローで待機中の件数はサイクル summary の `pending` で返す。毎サイクルのログには出さない）

## DM 送信エンドポイント（要検証）

Web クライアントが使う内部エンドポイントを叩く。実装前に 1 回、実ブラウザからの DM 送信を
`webtrace` でキャプチャして payload / header を確定する。想定:

```
POST https://x.com/i/api/1.1/dm/new2.json?ext=...&include_ext_alt_text=true&...
headers: authHeaders(acc, { json: true }) + x-client-transaction-id
body: { conversation_id: "<小さいID>-<大きいID>", recipient_ids: false, request_id: <uuid>,
        text, cards_platform: "Web-12", include_cards: 1, include_quote_count: true, dm_users: false }
```

未検証のまま実装した場合は `docs/autodm.md` に「未検証」と明記し、初回は `--dry-run` →
1通の実送信で確認してから本番運用する。

## エラー処理

- `XSessionError`: そのアカウントのサイクルを中断、`session_error` をログ。`--loop` は継続。
- 検索/プロフィール取得失敗: そのリプは今回スキップ（state は変更しない）。次サイクルで再試行。
- DM失敗: `attempts` 加算、3回で `failed`。HTTP 429 は即サイクル中断（当日の残りは送らない）。
- state 書き込みは一時ファイル → rename でアトミックに行う。

## 安全策（凍結対策）

- ポーリング最短 300 秒（設定でそれ未満を指定しても 300 に丸める）
- DM 間ジッタ 30〜90 秒（既定）、日次上限 50（既定、最大 500 で丸める）
- 同一 `post_id × user_id` には二度と送らない
- DM本文の URL は 1 つまでを推奨（docs に記載、コードでは強制しない）

## テスト

- `node:test` 単体: `matchKeyword`（NFKC/大小/空白）、候補抽出（トリガー一致・自分除外・dedupe）、
  pending の期限切れ、daily cap、state の round-trip。ネットワークは fixture の JSON で差し替える。
- 手動: 1アカウントで `--dry-run --once` → 実投稿1件＋自分のサブ垢からリプ → 実送信1通確認 → 3アカウント展開。

## 未決事項 / 依存

- 3アカウントとも x-api 未登録。`login_browser.mjs` によるブラウザログインが必要（サンドボックス外で実行）。
- DM エンドポイントの実キャプチャはログイン済みブラウザが要るため、上記ログイン後に行う。
