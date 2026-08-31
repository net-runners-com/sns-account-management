# autodm — キーワードリプ → 自動DM

自分の投稿に指定キーワードを含むリプをした **フォロワー** に DM を送る。非Premium前提。

## 前提（Xの仕様）

- 非Premiumは **相手が自分をフォローしている時だけ** DM を送れる。未フォローは `pending` に置き、
  `pending_days`（既定7日）の間、毎サイクル再判定する。
- X の DM 上限は 500通/日。既定 `daily_cap` は 50。
- 催促リプ等は打たない。DM本文の URL は 1 つまで推奨（スパム判定回避）。

## セットアップ

1. アカウント登録: `node login_browser.mjs --account <name>`（AGENTS.md §2）→ `node check_session.mjs --account <name>` で OK を確認
2. 設定: `cp autodm/example.json autodm/<name>.json` して編集
   - `post_id`: 対象投稿の URL 末尾の数字（`https://x.com/<user>/status/<post_id>`）
   - `keywords`: 大小・全角半角・空白は無視して部分一致
   - `dm_text`: 送る本文（URL は 1 つまで推奨）
3. ドライラン: `node autodm.mjs --account <name> --dry-run`
   - stderr に `matched` / `dry_run` が出れば照合・フォロー判定まで動いている
4. 実送信 1 通で確認 → `--loop` へ
   - **確認用のテスト垢は必ず本番アカウントをフォローした状態**にする（`followed_by` ゲートを
     end-to-end で検証するため。未フォローのままだと `sent` が出ず「動いているのか壊れているのか」
     判別できない）。
   - この初回の実送信時に `webtrace` skill か DevTools Network タブで実際の `dm/new2.json`
     リクエストをキャプチャしておく（`lib/dm.mjs` は「要検証」実装のため、実物と差分があれば
     `DM_QUERY` / `buildDmRequest` の body をここで合わせる）。

## 実行

```bash
node autodm.mjs --account <name>            # 1回（--once が既定）
node autodm.mjs --all                       # 全アカウントを順に1回ずつ
```

**本番運用は launchd + `--once`（既定）を推奨する**。`--loop` はデバッグ用途に留める:
長生きプロセスは `x-client-transaction-id` の生成器を内部でキャッシュしており、X 側がバンドルを
ローテーションすると生成した id が古くなり、原因が分かりにくい 403/404 を出し始める。`--once` を
`StartInterval` で毎回起動し直せば、起動のたびに生成器が作り直されるためこの問題を踏まない。
`--all --loop [--interval <sec>]` は動作確認・デバッグ時にだけ使う:

```bash
node autodm.mjs --all --loop --interval 900   # デバッグ用: 長生きプロセスでポーリング
```

launchd（推奨・本番）では `--once`（既定）を `StartInterval` で叩く:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.sns.x-autodm</string>
  <key>ProgramArguments</key><array>
    <string>/opt/homebrew/bin/node</string>
    <string>/ABS/PATH/packages/x-api/autodm.mjs</string>
    <string>--all</string>
  </array>
  <key>WorkingDirectory</key><string>/ABS/PATH/packages/x-api</string>
  <key>StartInterval</key><integer>600</integer>
  <key>StandardOutPath</key><string>/ABS/PATH/packages/x-api/data/autodm.launchd.out.log</string>
  <key>StandardErrorPath</key><string>/ABS/PATH/packages/x-api/data/autodm.launchd.err.log</string>
</dict></plist>
```

`~/Library/LaunchAgents/com.sns.x-autodm.plist` に置いて `launchctl load` する。

## ファイル

| パス | 内容 |
|---|---|
| `autodm/<account>.json` | 設定（`example.json` 参照） |
| `data/<account>/autodm_state.json` | `sent` / `pending` / `failed` / `expired` / `daily` / `me` / `rate_limited_until` |
| `data/<account>/autodm_log.jsonl` | イベント: `matched` `sent` `dry_run` `dm_failed` `rate_limited` `cap_reached` `expired` `session_error` `profile_failed` `cycle` |

### 設定キー（`autodm/<account>.json`）

| キー | 既定値 | 内容 |
|---|---|---|
| `daily_cap` | 50（最大500） | 1日あたりの送信上限 |
| `poll_interval_sec` | 600（最短300） | `--loop` 時のポーリング間隔 |
| `pending_days` | 7 | 未フォローを `pending` に留める日数。超えたら `expired`（終端・二度と送らない） |
| `dm_delay_sec` | `[30, 90]` | DM 送信前のジッタ（秒） |
| `search_max_pages` | 3 | リプ検索のページ数（1ページ20件） |
| `pending_check_limit` | 50 | 1サイクルで再判定する pending の上限人数（`last_checked` が古い順） |
| `profile_delay_sec` | `[1, 3]` | pending のプロフィール再取得ごとのジッタ（秒）。1件目には挟まない |

## 挙動の要点

- 同じ `post_id × user_id` には二度と送らない（`sent` / `failed` / `expired` に入ったら再送しない）。
  `expired` は終端状態: `pending_days` を過ぎて `expired` に移った相手は、その後フォローしても
  二度とDMは届かない（次サイクルで再判定されるのは `pending` のみ）。
- DM 失敗は 3 回で `failed`。HTTP 429 は「当日の残りは送らない」仕様: `attempts` は増やさず
  `rate_limited_until`（翌ローカル日付の 0 時）をセットしてサイクルを打ち切る。以降のサイクルは
  `rate_limited_until` を過ぎるまで `sendDm` を一切呼ばない。
- セッション切れ（`XSessionError`）はそのアカウントをスキップしてログに残す。`--loop` は止まらない。
  → `node login_browser.mjs --account <name>` で再ログイン。
- pending 1件のプロフィール取得が失敗しても（`profile_failed`）そのアカウントの他の pending や他の
  トリガーは止めない。state は変更せず次サイクルで再試行する。
- `pending` が多いと毎サイクル全員のプロフィール取得が走っていたが、`pending_check_limit`
  （既定50）で1サイクルの再判定数を絞っている。人数が多いアカウントは `pending_check_limit` か
  `pending_days` を調整する。
- `dayKey`（日次カウントの日付境界）と `daily_cap` は **プロセスのローカル時刻** で判定する。
  launchd はシェルと異なる `TZ` で起動されることがあるので、日付が想定とズレる場合はまず
  `launchctl print` 等でプロセスの `TZ` を確認する。
- 上限まで詰まった1サイクルは `daily_cap`（既定50）× `dm_delay_sec`（30〜90秒）で
  最大 約75分かかる。「10分おきに実行」のような前提は、送信対象が多い日には成立しなくなる
  （`poll_interval_sec` より1サイクルが長引く）点に注意。
- リプ取得は `to:<me> -from:<me>` の Latest 検索（`search_max_pages` × 20件）。サイジングの目安:
  **`search_max_pages × 20` は、全トリガー投稿合計でポーリング間隔中に届くリプ数を上回る必要がある**。
  サイクル末尾の `cycle` イベントの `replies_fetched` が `search_max_pages × 20` に張り付いている
  （＝毎回ちょうど上限件数を取得している）状態は検索窓が飽和しているサインなので `search_max_pages`
  を増やす。
  - 将来の改善案（未検証）: トリガーごとに `conversation_id:<post_id> -from:<me>` で個別検索すれば
    投稿単位の取りこぼしを避けられる可能性があるが、未検証。

## DM エンドポイントについて（要検証）

`lib/dm.mjs` は Web クライアントの `POST /i/api/1.1/dm/new2.json` を再現している。X 側の変更で
query / body が変わることがあるので、送信が 400/404 で落ちる時は実ブラウザから DM を 1 通送って
リクエストをキャプチャし（`webtrace` skill か DevTools の Network タブ）、`DM_QUERY` と `buildDmRequest` の
body を合わせる。

## トラブル

| 症状 | 対処 |
|---|---|
| `X account not found` | `login_browser.mjs` でログイン |
| `autodm config not found` | `autodm/<account>.json` を作る |
| `matched` が出ない | `post_id` が正しいか / キーワードがリプ本文に含まれているか / 検索に反映されるまで数分待つ |
| `sent` が出ず pending のまま | 相手が未フォロー。`followed_by` が true になるまで待つ。全員が pending のままなら `node profile.mjs --account <name> --user-id <既知のフォロワー>` で `followed_by` が返るか確認（返らなければ GraphQL 応答の形が変わっている） |
| `DM HTTP 4xx` | 上記「DM エンドポイントについて」 |
