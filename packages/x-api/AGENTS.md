# AGENTS.md — claude code 向け x-api 利用ガイド

このパッケージは **X (Twitter) Web GraphQL を pure HTTP で叩く Node.js ライブラリ + CLI**。
ユーザーが X 関連のタスクを依頼してきたら、このガイドに従ってこのパッケージを使う。

> このファイルは claude code (および互換エージェント) が読むためのガイド。人間用の概要は `README.md`、API リファレンスは `docs/api.md`、ログイン方式の詳細は `docs/login.md`、タスク別レシピは `docs/recipes.md` を参照。

---

## できること / できないこと

| カテゴリ | できる | できない |
|---|---|---|
| 読み取り | プロフィール / 投稿一覧 / 検索 / フォロー一覧 | リアルタイム push, トレンド |
| 書き込み | DM 送信 (`lib/dm.mjs`, `autodm.mjs`) | 投稿 / リプライ / いいね / フォロー操作 |
| 認証 | env credentials 経由の純 HTTP ログイン / ブラウザ対話ログイン | OAuth ユーザー認可フロー (X API v2 と無関係) |
| 制限 | アカウント単位の rate limit に乗る | 2FA 必須アカウントの env credentials 自動ログイン (ブラウザ方式に切替) |

---

## 0. ファイル配置

| 種類 | デフォルトパス | 上書き env | 注意 |
|---|---|---|---|
| アカウント (cookies) | `<package>/accounts/x_accounts.json` | `X_ACCOUNTS_PATH` | 直接編集禁止. `saveAccount()` 経由のみ |
| 取得データ | `<package>/data/<account>/<task>_<context>_<timestamp>.json` | `X_DATA_PATH` | 全 CLI が**デフォルトで自動保存**. `--no-save` で抑制 |

CLI 実行のたびに `[<task>] saved: <path>` が stderr に出るので、それを report するとユーザーが「結果どこ?」となりにくい。

---

## 1. ユーザー要求への最初の応答

ユーザーが X 関連の依頼をしたら **最初に必ず** アカウントの状態確認:

### 1.1 アカウントが指定されている場合

```bash
node check_session.mjs --account <name>
```

- 0 終了 = セッション生きてる → タスク続行
- 非 0 = セッション死亡 or アカウント未登録 → §2 のログインプロトコルへ

### 1.2 アカウントが未指定の場合

```bash
node -e "import('./session.mjs').then(m => console.log(Object.keys(m.loadAccounts())))"
```

で登録済みアカウント一覧を表示し、ユーザーに選んでもらう。空ならログイン必要。

---

## 2. ★ ログインプロトコル（最重要）

ユーザーが「ログインしたい」「セッション切れた」「アカウント追加して」等と言ったら **このプロトコルを厳密に守る**。

### 2.1 ブラウザ対話方式（推奨・デフォルト）

CloakBrowser windowed で起動 → ユーザーが手動ログイン → **signal file ハンドシェイク** で claude code が完了通知。
2FA / captcha / phone verify があっても人間が処理できるので最も確実。

#### 手順

| # | 動作 | コマンド / 注意 |
|---|---|---|
| 1 | 背景起動 (**必ず run_in_background: true**) | `node login_browser.mjs --account <name>` |
| 2 | 初期出力から signal file path を取得 | stdout 最初の行: `SIGNAL_FILE=<path>` |
| 3 | ユーザーに合図を依頼 | 「ブラウザで X にログインしてください。完了したら『ok』と伝えてください」 |
| 4 | **ユーザー返事を待つ** | 自分から polling しない、sleep しない |
| 5 | ユーザーが ok と言ったら signal 送信 | `touch <signal_file_path>` |
| 6 | 背景タスク完了通知を待つ | 自動で来る、こちらから check しない |
| 7 | 結果報告 | stdout に `✅ session alive` が出てれば成功 |

#### やってはいけないこと

- ❌ `run_in_background: true` を付けずに起動 → blocking でハング
- ❌ ユーザーの返事より先に自分で touch → ログイン未完了で cookie 不完全
- ❌ 背景タスクが終わる前に追加 API リクエスト → 401 を踏む
- ❌ `accounts/x_accounts.json` を直接編集 → `saveAccount()` 必須

#### よくあるエラー

| エラー | 原因 | 対処 |
|---|---|---|
| `signal 受信したが auth_token cookie が無い` | ユーザーがログイン完了せずに ok と言った | 再起動してログインからやり直し |
| `timeout: signal file ... not created` | 10 分以上 ユーザー応答なし | 状況確認、または `--timeout` を伸ばして再起動 |
| `session not detected as alive` | cookie 保存はできたが auth 通らない | captcha / phone verify が残ってる、別アカウントの cookie になってる等。`check_session.mjs --account <name>` で詳細確認 |

### 2.2 env credentials 方式（2FA 無効アカウント用）

`/i/api/1.1/onboarding/task.json` の subtask state machine を純 HTTP で進める。ブラウザ不要。

```bash
X_LOGIN_USERNAME_<NAME>=<username> X_LOGIN_PASSWORD_<NAME>=<password> \
node login.mjs --account <name>
```

- `<NAME>` は account 名を大文字化 + 非英数字を `_` に変換した形（例: `hirotohiroto_x` → `HIROTOHIROTO_X`）
- 2FA / captcha / phone verify があるアカウントは失敗する → §2.1 のブラウザ方式に切替

### 2.3 透過的自動再ログイン

通常の API 呼び出し中にセッション切れを検出すると `lib/auto_relogin.mjs` が自動再ログインする（§2.2 の credentials を env に置いていれば）。明示呼び出し不要。

---

## 3. タスク別 CLI

詳細は `docs/recipes.md`。

| ユーザー要求 | コマンド |
|---|---|
| プロフィールを見たい | `node profile.mjs --account <name> --screen-name <target>` |
| 全投稿を取得 | `node posts.mjs --account <name> --screen-name <target>` |
| キーワード検索 | `node search.mjs --account <name> --q "<keyword>"` |
| フォロー一覧 | `node follows.mjs --account <name> --screen-name <target> --type following` |
| フォロワー一覧 | `node follows.mjs --account <name> --screen-name <target> --type followers` |

全 CLI の共通フラグ:
- `--raw` — レスポンス 1 ページ目の生 JSON
- `--no-save` — `data/` への自動保存をスキップ (stdout のみ)
- `--save-dir <path>` — 保存先ルート上書き

出力は常に stdout に JSON、ファイル保存と独立。パイプ用途と保存用途を両立できる。

---

## 4. プログラマティック API

`import { ... } from "./lib/index.mjs"` で全 export 取得可能。

```js
import {
  getAccount, isSessionAlive,           // session
  getProfileByScreenName,                // profile
  getAllUserTweets, fetchUserTweetsPage, // tweets
  fetchSearchPage,                       // search
  reloginAccount, loginWithCredentials,  // auth
} from "./lib/index.mjs";
import { browserLogin } from "./lib/browser_login.mjs";  // 対話ログイン
```

詳細シグネチャは `docs/api.md`。

---

## 5. エラーハンドリングのコツ

- `XSessionError` (lib/errors.mjs) — セッション死亡。401 / 403 / 326 / 88 等を吸収。**catch して再ログインを案内する**
- `XGraphQLError` — API レベルエラー（rate limit / private user / suspended 等）。エラーコードに応じてユーザーに説明
- generic Error — ネットワーク / parse 失敗。リトライ可能なら 1 回だけ再試行

---

## 6. レート制限 / マナー

- アカウント単位の rate limit (`x-rate-limit-remaining` / `-reset` ヘッダ)。lib/http.mjs が監視してる
- 連続リクエストは 1-3 秒間隔を推奨（特に `posts.mjs` の pagination）
- 同一アカウントで複数並列スクリプトを走らせない（rate limit を奪い合う）

---

## 7. このパッケージを更新する時

- 既存 .mjs を編集する前に README / AGENTS.md / docs/ を見て影響範囲を把握
- 新しい endpoint を追加したら `lib/index.mjs` の re-export と `docs/api.md` を更新
- ログインフローを変える時はこの AGENTS.md §2 を必ず更新（recipient の claude code が読む）
