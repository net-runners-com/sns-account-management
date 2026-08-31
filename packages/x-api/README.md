# x-api

X (Twitter) Web GraphQL を **pure HTTP** で叩く Node.js ライブラリ + CLI パッケージ。
Cookie 認証 + `x-client-transaction-id` 自動署名で、ブラウザ自動化なしで検索・プロフィール・投稿一覧を取得できる。

```
プロフィール / 全投稿 / 検索 / フォロー一覧
       │
   pure HTTP
       │
  x.com Web GraphQL (UserByScreenName, UserTweets, SearchTimeline, Following, Followers)
```

## 主な機能

| 機能 | CLI | プログラム API (`lib/index.mjs`) |
|---|---|---|
| セッション生死確認 | `check_session.mjs` | `isSessionAlive(name)` |
| プロフィール取得 | `profile.mjs` | `getProfileByRestId`, `getProfileByScreenName` |
| 全投稿取得 (pagination 込) | `posts.mjs` | `getAllUserTweets`, `fetchUserTweetsPage` |
| 検索 (Top / Latest / People / Photos / Videos) | `search.mjs` | `searchAll`, `fetchSearchPage` |
| フォロー / フォロワー一覧 | `follows.mjs` | `getAllFollowing`, `getAllFollowers` |
| ブラウザ対話ログイン | `login_browser.mjs` | `browserLogin()` |
| env credentials ログイン | `login.mjs` | `loginWithCredentials`, `reloginAccount` |
| 期限切れ自動再ログイン | (透過的) | `reloginAccount` |
| キーワードリプ → 自動DM | `autodm.mjs` | `runCycle`, `sendDm` |

## クイックスタート

### 1. インストール

```bash
cd packages/x-api
npm install
```

### 2. アカウント登録（ログイン）

**初回 / 推奨: ブラウザ対話ログイン**

```bash
node login_browser.mjs --account my_account
```

CloakBrowser が起動し、x.com/login が開く。手動でログイン後、別ターミナルで:

```bash
touch /tmp/x_login_my_account.ready
```

→ cookies が `accounts/x_accounts.json` に自動保存され、`isSessionAlive` で検証。

**Claude Code から使う場合**: signal file ハンドシェイクの正確な手順は `AGENTS.md` §2 を参照。

**advanced: env credentials 方式 (2FA 無効アカウントのみ)**

```bash
X_LOGIN_USERNAME_MY_ACCOUNT=net_runners__ \
X_LOGIN_PASSWORD_MY_ACCOUNT=xxxxx \
node login.mjs --account my_account
```

### 3. 動作確認

```bash
node check_session.mjs --account my_account
# → OK: session alive (my_account) — @net_runners__  followers=0  following=5  tweets=35
```

### 4. 使ってみる

```bash
# プロフィール
node profile.mjs --account my_account --screen-name elonmusk

# 全投稿
node posts.mjs --account my_account --screen-name elonmusk --max 100

# 検索
node search.mjs --account my_account --product Latest "Claude Code"

# フォロー
node follows.mjs --account my_account --screen-name elonmusk --following
```

### 5. 取得データの保存先

全 CLI は **デフォルトで** stdout への JSON 出力に加えて `<package>/data/<account>/<task>_<context>_<timestamp>.json` にも保存する。

```
packages/x-api/data/
└── my_account/
    ├── profile_elonmusk_2026-05-17T00-23-45.json
    ├── posts_elonmusk_2026-05-17T00-24-10.json
    ├── search_Latest_Claude-Code_2026-05-17T00-25-30.json
    └── follows_elonmusk_Following_2026-05-17T00-26-15.json
```

| フラグ | 効果 |
|---|---|
| (なし) | デフォルト保存先に書く + stdout JSON |
| `--no-save` | stdout のみ。ファイル書かない |
| `--save-dir <path>` | 保存先ルートを上書き |
| `X_DATA_PATH=<path>` env | 全 CLI のデフォルト保存先を上書き |

## ドキュメント

| ファイル | 用途 |
|---|---|
| `README.md` | (本ファイル) 概要 + クイックスタート |
| `AGENTS.md` | **claude code 向け** ガイド。ログインプロトコル / エラー対処 |
| `docs/login.md` | ログイン方式の詳細 (ブラウザ対話 / env credentials / cookie 直接貼り) |
| `docs/api.md` | プログラマティック API リファレンス |
| `docs/recipes.md` | よくあるタスクの生コード例 |
| `docs/autodm.md` | キーワードリプ → 自動DM の設定・運用 |

## 設定

| 環境変数 | 効果 |
|---|---|
| `X_ACCOUNTS_PATH` | `accounts/x_accounts.json` のパス上書き |
| `X_DATA_PATH` | 取得データの保存先ルート上書き (デフォルト: `<package>/data/`) |
| `X_LOGIN_USERNAME_<NAME>` | env credentials ログイン用 username |
| `X_LOGIN_PASSWORD_<NAME>` | env credentials ログイン用 password |

## 主要依存

| package | 用途 |
|---|---|
| `cloakbrowser` | ブラウザ対話ログイン (stealth Chromium) |
| `camoufox-js` | 一部 endpoint の fallback |
| `x-client-transaction-id` | `x-client-transaction-id` ヘッダ生成 |

## 制限

- **書き込み系操作なし** (投稿 / リプライ / いいね / フォロー操作 / DM)
- **2FA 必須アカウント**は env credentials 方式不可 → ブラウザ対話ログイン推奨
- アカウント単位の **rate limit** あり (詳細は `AGENTS.md` §6)

## ライセンス

private / internal use only.
