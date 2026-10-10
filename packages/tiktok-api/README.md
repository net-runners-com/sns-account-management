# tiktok-api

TikTok web API クライアント + CLI。pure HTTP では ORCAS bot 検知に弾かれるため、
[Camoufox](https://github.com/daijro/camoufox)（anti-detect Firefox）でブラウザ経由の
API レスポンスを intercept して取得する。現状は **read 系（検索 / トレンド）** のみ対応。

## できること

| CLI | 内容 | intercept する endpoint |
| --- | --- | --- |
| `search.mjs`   | キーワード検索（動画 / ユーザー / ハッシュタグ） | `/api/search/general/full/` |
| `trending.mjs` | Explore / おすすめのバズり動画 | `/api/(recommend\|explore)/item_list/` |
| `user.mjs`     | 指定ユーザーの投稿動画 一覧 | `/api/post/item_list/` + universal-data |
| `video.mjs`    | 個別動画の詳細（タグ/音源/動画メタ/統計） | `/api/item/detail/` + universal-data |

## セットアップ

```bash
cd packages/tiktok-api
npm install        # camoufox-js（node_modules は同梱済み）
npx camoufox-js fetch   # 初回のみ: Camoufox ブラウザ本体を取得
```

Node は `>=21`。

## アカウント

セッションはリポジトリ共有の `accounts/tiktok_accounts.json`（プロジェクト root）を参照する。
読み取り専用の検索 / トレンドは **`guest`（cookie 注入なし）** で動く。これは
古い msToken / ttwid を inject すると ORCAS に逆検知され空レスポンスになるのを回避するため。

```jsonc
// accounts/tiktok_accounts.json （synthetic 例）
{
  "guest": {},
  "myacct": {
    "cookies": "sessionid=...; ttwid=...; msToken=...",
    "msToken": "...",
    "device_id": "7637873442330986004"
  }
}
```

ログインが要る write 系操作では `getAccount(name)` の cookie を使い、`useCookies: true` で起動する。

## 使い方

```bash
# 検索（デフォルト guest / 20件）
node search.mjs "寿司"
node search.mjs --count 50 --sort likes "寿司"        # いいね順
node search.mjs --sort recent --days 7 "寿司"          # 直近7日 新着順
node search.mjs --min-likes 10000 --min-views 1000000 "寿司"
node search.mjs --headed "寿司"                        # ブラウザUI表示（デバッグ）
node search.mjs --raw "寿司"                           # 生 JSON

# トレンド（Explore / おすすめ）
node trending.mjs                                      # 20件・いいね順
node trending.mjs --count 50 --min-likes 10000
node trending.mjs --raw

# ユーザーの投稿動画 一覧（新着順）
node user.mjs xxpeony                                  # @xxpeony を30件
node user.mjs @xxpeony --count 50 --sort likes        # いいね順50件
node user.mjs https://www.tiktok.com/@xxpeony --pretty # URL可・人間向け整形
node user.mjs xxpeony --raw                            # 生 itemList

# 個別動画の詳細（タグ/音源/動画メタ/統計）
node video.mjs https://www.tiktok.com/@xxpeony/video/7640825817336958240 --pretty
node video.mjs 7640825817336958240 --author xxpeony    # id + 投稿者でも可
node video.mjs <url> --raw                              # 生 itemStruct

# npm script でも可
npm run search -- "寿司"
npm run trending
npm run user -- xxpeony --pretty
npm run video -- <video-url> --pretty
```

> `user.mjs` → 一覧を取得 → 各動画の `url` を `video.mjs` に渡す、が基本フロー。
> 詳細は `/api/item/detail/` の intercept が空でも `__UNIVERSAL_DATA_FOR_REHYDRATION__`
> （SSR埋め込み）から fallback 取得するため、guest でも取れることが多い。

アカウント切替は `--account <name>` か環境変数 `TIKTOK_ACCOUNT`。

### 共通オプション

| オプション | 説明 | 既定 |
| --- | --- | --- |
| `--account <name>` | 使用アカウント | `guest`（`TIKTOK_ACCOUNT` でも可） |
| `--count <N>` | 取得件数 | `20` |
| `--min-likes <N>` / `--min-views <N>` | いいね / 再生のしきい値 | `0` |
| `--headed` | ブラウザ UI を表示 | off（headless） |
| `--raw` | 整形せず生レスポンスを出力 | off |

`search.mjs` 追加分: `--sort relevance｜likes｜recent`、`--days 0｜1｜7｜30｜90｜180`、`--min-comments <N>`。

出力は JSON を **stdout**、進捗ログは **stderr** に出る（`> out.json` でデータだけ保存できる）。

## ライブラリとして使う

```js
import { getAccount, baseApiParams, browserHeaders } from "tiktok-api/session";
import { launchCamoufox, captureApiResponses } from "tiktok-api/browser";
import { signParams } from "tiktok-api/sign";   // X-Bogus + X-Gnarly 署名
```

## 構成

```
session.mjs        アカウント / 共通ヘッダ / signed-API パラメータ
search.mjs         検索 CLI
trending.mjs       トレンド CLI
lib/browser.mjs    Camoufox ラッパー + レスポンス intercept
lib/sign/          X-Bogus / X-Gnarly 署名（signed HTTP 用）
```
