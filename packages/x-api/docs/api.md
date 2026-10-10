# Programmatic API

`lib/index.mjs` から全 export を取得。ESM 専用 (`"type": "module"`)。

```js
import {
  getAccount, loadAccounts, saveAccount, isSessionAlive,
  authHeaders, X_WEB_BEARER,
  xFetch,
  XSessionError, detectSessionError, formatSessionErrorForCLI,
  getProfileByRestId, getProfileByScreenName, summarizeProfile,
  fetchUserTweetsPage, extractTweetsAndCursor, getAllUserTweets,
  loginWithCredentials, reloginAccount, getCredentials,
} from "./lib/index.mjs";

// 検索 / フォロー / 対話ログインは別 import
import { fetchSearchPage, searchAll } from "./lib/search.mjs";
import { getAllFollowing, getAllFollowers, fetchFollowsPage } from "./lib/follows.mjs";
import { browserLogin, defaultSignalFile } from "./lib/browser_login.mjs";
```

---

## save

### `saveData(opts: { account, task, context?, data, dir?, suffix? }): string`
データを JSON ファイルに保存して保存先パスを返す。

- `account` — 保存先サブディレクトリ名
- `task` — タスク名 (`"posts"` / `"profile"` / `"search"` / `"follows"` 等)
- `context` — filename に含める文脈識別子 (screen-name / query / user-id 等). 省略可
- `data` — JSON シリアライズ可能な値
- `dir` — data ルート上書き. デフォルトは `DEFAULT_DATA_DIR`
- `suffix` — task と context の間に挟む追加 suffix (例: `"raw"`, `"Latest"`)

filename: `<task>[_<suffix>][_<context>]_<ISO timestamp>.json`

### `parseSaveFlags(argv: string[]): { noSave, saveDir, remaining }`
CLI argv から `--no-save` / `--save-dir` を抜き出す。CLI 実装で使う。

### `DEFAULT_DATA_DIR: string`
デフォルト data ルート. `process.env.X_DATA_PATH` があればそれ、無ければ `<package>/data/`。

---

## session

### `loadAccounts(): Record<string, Account>`
`accounts/x_accounts.json` の全アカウントを読み込む。ファイル無しなら `{}`。

### `getAccount(name: string): Account`
アカウントを取得。無ければ throw。`auth_token` / `ct0` がなければ throw。

### `saveAccount(name: string, patch: Partial<Account>): void`
アカウントをマージ保存。新規キーは作成、既存はマージ（patch 優先）。`accounts/` 親ディレクトリは自動作成。

### `isSessionAlive(name: string): Promise<boolean>`
UserByRestId を叩いて自分の profile が取れるか確認。エラー握りつぶしの簡易版。詳細は CLI の `check_session.mjs`。

### `authHeaders(acc: Account, opts?: { json?: boolean, referer?: string }): Record<string,string>`
X web GraphQL/REST 呼び出し用の標準ヘッダ生成。Bearer / Cookie / x-csrf-token / x-twitter-auth-type 等を含む。

### `X_WEB_BEARER: string`
X web の固定 Bearer (公開値、何年も rotate されてない)。

---

## http

### `xFetch(acc: Account, url: string, init?: RequestInit, opts?: { accountName?: string, autoRelogin?: boolean }): Promise<Response>`
認証ヘッダ付きの fetch ラッパー。

機能:
- `x-client-transaction-id` ヘッダ自動付与
- 401 / 403 / `code: 32 / 64 / 88 / 89` の検出 → autoRelogin=true なら 1 度だけ再ログイン → リトライ
- レート制限ヘッダの観測 (`x-rate-limit-remaining`, `-reset`)

---

## profile

### `getProfileByScreenName(acc, opts: { screenName, accountName? }): Promise<Profile>`
`@screen_name` から profile 取得。内部で UserByScreenName GraphQL を叩く。

### `getProfileByRestId(acc, opts: { userId, accountName? }): Promise<Profile>`
数値 user_id から profile 取得。UserByRestId GraphQL。

### `summarizeProfile(profile): string`
人間可読 1 行サマリ生成 (`@name  followers=X  following=Y  tweets=Z`)。

### Profile 型 (主なフィールド)
```ts
{
  user_id: string,
  screen_name: string,
  name: string,
  description: string,
  followers_count: number,
  following_count: number,
  statuses_count: number,
  created_at: string,
  verified: boolean,
  protected: boolean,
  // ... (raw raw object 同梱)
}
```

---

## user_tweets

### `fetchUserTweetsPage(acc, opts: { userId, cursor?, count?, accountName? }): Promise<{ tweets, nextCursor }>`
1 ページ取得。`cursor` 指定で続き、無ければ最初から。`count` デフォルト 40。

### `getAllUserTweets(acc, opts: { userId, accountName?, maxPages?, onPage? }): Promise<Tweet[]>`
pagination 自動で全件取得。`maxPages` で安全停止 (デフォルト 50)、`onPage(tweets, page)` で各 page でコールバック。

### `extractTweetsAndCursor(raw): { tweets, nextCursor }`
GraphQL raw レスポンスから tweets と次の cursor を抽出（低レベル）。

### Tweet 型 (主なフィールド)
```ts
{
  id: string,
  text: string,
  created_at: string,
  author: { user_id, screen_name, name },
  favorite_count: number,
  retweet_count: number,
  reply_count: number,
  quote_count: number,
  view_count: number,
  media: Array<{ type, url, ... }>,
  is_reply: boolean,
  is_retweet: boolean,
  is_quote: boolean,
  // ... + raw
}
```

---

## search

### `fetchSearchPage(acc, opts: { query, product?, cursor?, accountName? }): Promise<{ items, nextCursor }>`

`product`:
- `Top` — おすすめ順 (デフォルト)
- `Latest` — 新着順
- `People` — ユーザー検索
- `Photos` — 画像ツイートのみ
- `Videos` — 動画ツイートのみ

### `searchAll(acc, opts: { query, product?, accountName?, maxPages? }): Promise<Item[]>`
全件取得。`product=People` だと items は profile、それ以外は tweet。

---

## follows

### `fetchFollowsPage(acc, opts: { userId, type, cursor?, accountName? }): Promise<{ users, nextCursor }>`

`type`: `"following"` | `"followers"`

### `getAllFollowing(acc, opts: { userId, accountName?, maxPages? }): Promise<User[]>`
全フォロー取得。

### `getAllFollowers(acc, opts: { userId, accountName?, maxPages? }): Promise<User[]>`
全フォロワー取得（大量だと rate limit 注意、maxPages で制限推奨）。

---

## login

### `browserLogin(opts: { accountName, signalFile?, timeoutSec?, headless?, persist?, log? }): Promise<Account>`
ブラウザ対話ログイン (CloakBrowser windowed) + signal file ハンドシェイク。`AGENTS.md` §2.1 参照。

### `defaultSignalFile(accountName: string): string`
デフォルト signal file パスを返す (`/tmp/x_login_<account>.ready`)。

### `loginWithCredentials(opts: { username, password }): Promise<LoginResult>`
純 HTTP の onboarding/task.json subtask state machine を進める。2FA / captcha があると throw。

### `reloginAccount(accountName: string): Promise<Account>`
env credentials を読んで再ログイン → cookies を accounts.json にマージ保存 → 新 Account 返す。

### `getCredentials(accountName: string): { username?, password? }`
`X_LOGIN_USERNAME_<NAME>` / `X_LOGIN_PASSWORD_<NAME>` (fallback: 無 suffix) を返す。

---

## errors

### `XSessionError extends Error`
セッション系エラーを統一表現。`.code` / `.subcode` / `.status` / `.body` を持つ。

### `detectSessionError(response, body): XSessionError | null`
fetch レスポンスから session error を検出。null なら正常。

### `formatSessionErrorForCLI(err): string`
CLI 表示用の見やすい 1〜数行に整形。

---

## Account 型 (full)

```ts
{
  user_id: string,
  screen_name?: string,
  auth_token: string,
  ct0: string,
  twid: string,
  kdt?: string,
  att?: string,
  guest_id?: string,
  personalization_id?: string,
  cookies: string,  // "auth_token=...; ct0=...; ..." 形式
  refreshed_at?: string,  // ISO 8601
  refreshed_via?: "browser_login" | "auto_relogin" | "manual",
}
```
