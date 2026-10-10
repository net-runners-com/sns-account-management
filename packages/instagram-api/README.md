# instagram-api

Instagram private web API (`/api/v1/`) を **pure Node + ブラウザ cookie** で叩く CLI / ライブラリ。
instagrapi / Python ブリッジ非依存。追加 npm 依存ゼロ（Node 21+ の native fetch / WebSocket のみ）。

## セットアップ（ログイン）

普段の Chrome で instagram.com にログイン済みなら **再ログイン不要**：

```bash
# A) 既存ログインを再利用 (headless・画面出ない・OS非依存)
node import_cdp.mjs --account me

# B) ブラウザを開いて手動ログイン (今ログインしてないアカウント用)
node login_cdp.mjs --account me
#   → 開いた Chrome で username/password を自分で入力。sessionid 検知で自動保存
```

どちらも `accounts/instagram_accounts.json` に保存。`INSTAGRAM_ACCOUNTS_PATH` 環境変数で保存先変更可。

> CDP 方式の仕組み: Chrome を `--remote-debugging-port` 付きで起動し、CDP `Storage.getCookies`
> で httpOnly の `sessionid` 込みで取得。復号は Chrome 本体がやるので Keychain/DPAPI を自前で
> 触らない＝ macOS / Linux / Windows 共通コード。

## CLI

| コマンド | 用途 |
|---|---|
| `node profile.mjs --account <n> <username> [--posts]` | プロフィール |
| `node posts.mjs --account <n> <username> [--max N]` | 投稿一覧 (pagination) |
| `node feed.mjs --account <n> [--stories]` | ホームフィード / ストーリーズ |
| `node dm_read.mjs --account <n> [--thread <id>]` | DM 受信箱 / スレッド |
| `node search.mjs --account <n> <kw>` | ブレンド検索 (users+hashtags) |
| `node search.mjs --account <n> --users <kw>` | ユーザー検索 |
| `node search.mjs --account <n> --tag <kw> [--max N]` | ハッシュタグ投稿 |
| `node media.mjs --account <n> <url\|code> [--download]` | 動画/画像 URL解決・DL |
| `node reels.mjs --account <n> <username> [--max N]` | ユーザーのリール一覧 (pagination) |
| `node reels.mjs --account <n> --discover` | discover / トレンドのリール |

各 CLI に `--raw` で生 JSON。`--account` の代わりに env `INSTAGRAM_ACCOUNT` も可。

`reels.mjs` 追加オプション: `--sort likes\|views\|recent` `--min-likes N` `--min-views N`。
取得経路は `clips/user`(target_user_id) と `clips/discover` の POST。`clips/home` は 404 で不可。
`INSTAGRAM_ACCOUNTS_PATH` 未設定時は repo-root の `accounts/` に自動フォールバックする。

## 認証レシピ（内部）

```
Cookie: sessionid / csrftoken / ds_user_id / ig_did / mid
Header:
  X-IG-App-ID:      936619743392459
  X-CSRFToken:      <csrftoken>
  X-ASBD-ID:        129477
  X-Requested-With: XMLHttpRequest
```

## 既知の制約

- `web_profile_info` は投稿エッジを返さない → 投稿は `feed/user/{id}` (posts.mjs が自動処理)
- `accounts/current_user` 等はモバイル UA 必須で web 経路不可
- read 専用 (like/comment/follow は未実装)
- 検索レスポンスは follower_count を含まない (実数は profile.mjs)
- IG CDN の mp4 URL は数時間で失効 → 解決→DL は続けて実行
- 大量アクセスは bot 検知リスク。jitter 入りだが控えめに

## 構成

```
session.mjs        accounts 読込 (env INSTAGRAM_ACCOUNTS_PATH or ./accounts/)
lib/http.mjs       認証ヘッダ付き fetch ラッパー
profile/posts/feed/dm_read/search/media .mjs   CLI
login_cdp.mjs      手動ログイン → CDP cookie 取得
import_cdp.mjs     既存ログイン再利用 → CDP cookie 取得
accounts/          セッション保存先 (.gitignore 済)
```
