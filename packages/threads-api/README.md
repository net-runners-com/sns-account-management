# threads-api

Threads (threads.com) の private web API を **pure Node HTTP** で叩く CLI / ライブラリ。
ログインは **CDP ブラウザ cookie 方式**（OS非依存・Keychain不要）。コア機能は instagrapi ブリッジ非依存。

## セットアップ

```bash
npm install        # tlsclientwrapper / libsodium-wrappers / ws (+ optional playwright)
```

### ログイン（CDP・OS非依存）

```bash
# A) 既存ログインを再利用 (headless・画面出ない)
node import_cdp.mjs --account me

# B) ブラウザを開いて手動ログイン (今ログインしてないアカウント用)
node login_cdp.mjs --account me
#   → 開いた Chrome で username/password 自分で入力。sessionid 検知で自動保存
```

保存先は `accounts/threads_accounts.json`（`THREADS_ACCOUNTS_PATH` で変更可）。

> 仕組み: Chrome を `--remote-debugging-port` 付き起動 → CDP `Storage.getCookies` で
> httpOnly の sessionid 込みで取得。復号は Chrome 本体がやるので Keychain/DPAPI を自前で
> 触らない＝ macOS / Linux / Windows 共通。

## CLI

### pure Node（ブリッジ不要・そのまま動く）

| コマンド | 用途 |
|---|---|
| `node check_session.mjs <acct>` | セッション生死確認 |
| `node post.mjs --account <a> --text "..."` | テキスト投稿 |
| `node posts.mjs --account <a> <username>` | 投稿一覧 (HTTP) |
| `node like.mjs` / `follow.mjs` / `repost.mjs` / `replies.mjs` / `delete.mjs` | エンゲージ操作 |
| `node search.mjs --account <a> --q "..."` | 検索 |
| `node trends.mjs --account <a>` | トレンド（※ playwright 必要） |
| `node activity.mjs --account <a>` | アクティビティフィード |
| `node inbox.mjs` / `dm_list.mjs` | DM 受信箱 / 一覧（読み取り） |
| `node profile_edit.mjs` / `user_fbid.mjs` / `shadowban_check.mjs` | その他 |

### instagrapi-bridge が必要（オプション機能）

`profile.mjs`（フルプロフィール）・`dm.mjs`（DM送信）・**写真投稿** は Threads-issued Bearer が要るため
同梱の `instagrapi-bridge/bridge.py` を使う。使う場合のみセットアップ：

```bash
cd instagrapi-bridge
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
```

各 CLI に `--raw` で生 JSON。`--account` の代わりに env `THREADS_ACCOUNT` も可。

## 構成

```
session.mjs        accounts 読込 (env THREADS_ACCOUNTS_PATH or ./accounts/)
lib/               HTTP/GraphQL/暗号/検索/投稿 等の実装
*.mjs              各 CLI
login_cdp.mjs      手動ログイン → CDP cookie 取得
import_cdp.mjs     既存ログイン再利用 → CDP cookie 取得
refresh_session.mjs  username/password 直ログイン (libsodium 暗号、challenge注意)
instagrapi-bridge/ オプション (profile / DM送信 / 写真投稿 用)
accounts/          セッション保存先 (.gitignore 済)
```

## 注意

- 大量アクセスは bot 検知リスク。ジッタ入りだが控えめに
- `refresh_session.mjs` は連続ログインで Meta challenge を食らうため 6h クールダウンあり
- trends / posts_all は内部で Playwright を使う（`npm i playwright` 済が前提）
