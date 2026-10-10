# Login Guide

x-api には 3 つのログイン方式がある。用途別に使い分け。

| 方式 | スクリプト | ブラウザ | 2FA 対応 | captcha 対応 | 推奨用途 |
|---|---|---|---|---|---|
| ブラウザ対話 | `login_browser.mjs` | あり (windowed) | ✅ | ✅ | 初回セットアップ / 普通の人が使う場合 |
| env credentials | `login.mjs` | なし | ❌ | ❌ | 2FA 無効 BOT 用アカウント / CI 自動化 |
| cookie 手貼り | (手動) | なし | N/A | N/A | DevTools から直接抜きたい場合のみ |

---

## 1. ブラウザ対話ログイン（推奨）

CloakBrowser (stealth Chromium) を **windowed (headless: false)** で起動。
ユーザーが手動でログイン → **signal file ハンドシェイク**で完了通知 → cookies 自動抽出。

### 1.1 単体使用 (terminal)

```bash
# Terminal 1
node login_browser.mjs --account my_account

# 別 Terminal 2 — ログイン完了後
touch /tmp/x_login_my_account.ready
```

### 1.2 claude code から使う

`AGENTS.md` §2.1 参照。background 起動 + signal file touch のハンドシェイク。

### 1.3 オプション

```
--account <name>      保存先アカウント名 (必須)
--signal <path>       signal file パス上書き
                      (デフォルト: /tmp/x_login_<account>.ready)
--timeout <sec>       signal 待ち最大秒 (デフォルト: 600)
--headless            (debug) ヘッドレス起動 — 通常使わない
--skip-validate       ログイン後の isSessionAlive チェック省略
```

### 1.4 動作の中身

1. `cloakbrowser.launch({ headless: false, humanize: true, locale: "en-US", timezone: "Asia/Tokyo" })`
2. `page.goto("https://x.com/login")`
3. signal file 出現を 500ms 間隔で polling
4. signal 検出 → `page.goto("https://x.com/home")` で ct0 等を確定
5. `ctx.cookies("https://x.com")` で全 cookie 取得
6. `parseUserIdFromTwid()` で `twid=u%3D<id>` から user_id 抽出
7. `saveAccount(name, record)` で `accounts/x_accounts.json` にマージ保存
8. ブラウザ閉じる
9. `isSessionAlive(name)` で UserByRestId を叩いて validate

### 1.5 抽出される cookie

| cookie | 用途 |
|---|---|
| `auth_token` | メイン認証 |
| `ct0` | CSRF トークン (`x-csrf-token` ヘッダにも使う) |
| `twid` | `u%3D<user_id>` 形式の URL エンコード user_id |
| `kdt` | 端末識別 (任意) |
| `att` | 認証補助 (任意) |
| `guest_id` | 任意 |
| `personalization_id` | 任意 |

---

## 2. env credentials ログイン

`/i/api/1.1/onboarding/task.json` の subtask state machine を順に進める純 HTTP 実装。
`lib/login.mjs` の `loginWithCredentials({ username, password })` が中身。

### 2.1 使い方

```bash
X_LOGIN_USERNAME_<NAME>=<username> \
X_LOGIN_PASSWORD_<NAME>=<password> \
node login.mjs --account <name>
```

`<NAME>` は account 名を大文字化 + 非英数字を `_` に変換したもの。例:

| account 名 | 期待される env 名 |
|---|---|
| `hiroto` | `X_LOGIN_USERNAME_HIROTO` |
| `hirotohiroto_x` | `X_LOGIN_USERNAME_HIROTOHIROTO_X` |
| `dev-account` | `X_LOGIN_USERNAME_DEV_ACCOUNT` |

fallback: account 別 env が無ければ `X_LOGIN_USERNAME` / `X_LOGIN_PASSWORD` を使う。

### 2.2 失敗パターン

| subtask | 意味 | 対処 |
|---|---|---|
| `LoginTwoFactorAuthChallenge` | 2FA コード要求 | ブラウザ方式に切替 |
| `ArkoseLogin` | captcha 要求 | ブラウザ方式に切替 (突破不可) |
| `LoginAcid` | 電話/メール認証要求 | ブラウザ方式に切替 |
| エラーコード 326 | アカウントロック | ロック解除後にリトライ |
| エラーコード 88 | rate limit | 数時間待ってリトライ |

### 2.3 透過的再ログイン

通常の API 呼び出し中に session 切れを検出すると `lib/auto_relogin.mjs` が自動でこのフローを走らせる。`X_LOGIN_USERNAME_<NAME>` / `X_LOGIN_PASSWORD_<NAME>` を env に置いておけば常に最新 cookie を維持できる。

---

## 3. cookie 手貼り (debug 用)

DevTools で抽出した値を直接 `accounts/x_accounts.json` に書く方式。**通常使わない**。

```json
{
  "my_account": {
    "user_id": "1983732467506016259",
    "auth_token": "ab8...",
    "ct0": "f87...",
    "twid": "u%3D1983732467506016259",
    "guest_id": "v1%3A...",
    "kdt": "...",
    "att": "...",
    "personalization_id": "v1_...",
    "cookies": "auth_token=...; ct0=...; twid=...; kdt=...; att=...; guest_id=...; personalization_id=...; lang=en"
  }
}
```

抽出元: Chrome DevTools → Application → Cookies → `https://x.com`

---

## トラブルシューティング

| 症状 | 原因 | 対処 |
|---|---|---|
| ブラウザが起動しない | cloakbrowser の Chromium 未 download | `npx cloakbrowser install` |
| `signal 受信したが auth_token cookie が無い` | ログイン完了前に signal 投げた | signal 削除して再起動、ログイン完了確認後に touch |
| `session not detected as alive` | cookie 不完全 or captcha 未消化 | `check_session.mjs` で詳細確認 |
| `XLoginError: stage=ArkoseLogin` | env credentials 方式で captcha | ブラウザ方式に切替 |
