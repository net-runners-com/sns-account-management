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

## 実行

```bash
node autodm.mjs --account <name>            # 1回
node autodm.mjs --all --loop                # 全アカウント順次・poll_interval_sec ごと（最短300秒）
node autodm.mjs --all --loop --interval 900
```

launchd で回す場合は `--once`（既定）を `StartInterval` で叩く:

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
| `data/<account>/autodm_state.json` | `sent` / `pending` / `failed` / `expired` / `daily` / `me` |
| `data/<account>/autodm_log.jsonl` | イベント: `matched` `sent` `dry_run` `dm_failed` `rate_limited` `cap_reached` `expired` `session_error` |

## 挙動の要点

- 同じ `post_id × user_id` には二度と送らない（`sent` / `failed` / `expired` に入ったら再送しない）。
- DM 失敗は 3 回で `failed`。HTTP 429 はそのサイクルを打ち切る。
- セッション切れ（`XSessionError`）はそのアカウントをスキップしてログに残す。`--loop` は止まらない。
  → `node login_browser.mjs --account <name>` で再ログイン。
- `pending` が多いと毎サイクル人数分のプロフィール取得が走る。数百人規模なら `pending_days` を短くする。
- リプ取得は `to:<me> -from:<me>` の Latest 検索（`search_max_pages` × 20件）。10分に 60 件以上リプが付く投稿では取りこぼす可能性がある → `search_max_pages` を増やす。

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
| `sent` が出ず pending のまま | 相手が未フォロー。`followed_by` が true になるまで待つ |
| `DM HTTP 4xx` | 上記「DM エンドポイントについて」 |
