# note-api (standalone package)

note.com の機能を**ブラウザ操作なし・API完結**で自動化するための実装一式。スタンドアロン版。

## クイックスタート

```bash
cd packages/note-api
npm install
cp accounts.example.json accounts/note_accounts.json   # 編集してCookie/clientCode/email を入れる
cp .env.example .env                                     # email/password を入れる (refresh で使う)

# 動作確認
npm run check

# .note ファイルを下書き保存
npm run post -- path/to/article.note

# セッションリフレッシュ
npm run refresh -- <accountName>
```

アカウントファイル位置は `NOTE_ACCOUNTS_PATH` 環境変数で上書き可能。デフォルトは `<package>/accounts/note_accounts.json`。

## 何ができるか

- 記事の作成・下書き保存・公開・削除（無料／有料両対応）
- 本文に挿入できるすべてのメディア: アイキャッチ／本文画像／音源プレイヤー／添付ファイル／SNS埋め込み
- 有料エリア（separator方式）
- 目次・コードブロック・引用（出典付き）
- コメント: 投稿／返信／編集／削除／いいね／一覧
- 記事スキ／フォロー／検索（記事・ユーザー・ハッシュタグ等）
- マルチアカウント切替
- `.note` 独自ファイル形式で「1ファイル → 公開まで」を自動化

## ディレクトリ構成

```
note-api/
├── lib/
│   ├── auth.mjs        Cookie + x-note-client-code 認証ヘッダ生成
│   ├── notes.mjs       記事CRUD / 公開 / コメント / スキ
│   ├── images.mjs      アイキャッチ / 本文画像 (S3 presigned)
│   ├── sounds.mjs      音源プレイヤー / 添付ファイル
│   ├── embeds.mjs      SNS埋め込み (X/Threads/YouTube/Spotify等)
│   ├── paywall.mjs     elements DSL / buildPaywallBody
│   ├── search.mjs      検索 (note/user/hashtag等)
│   ├── users.mjs       ユーザー取得 / フォロー / 関連ユーザー
│   ├── noteformat.mjs  .note パーサー / postNoteFile
│   └── index.mjs       公開窓口
├── session.mjs         セッション + マルチアカウント切替
├── note_helpers.mjs    旧API互換シム
├── post_note_file.mjs  .note CLI
├── accounts.json       (gitignore) 複数アカウントの認証情報
├── .env                (gitignore) 単一アカウントの認証情報
├── package.json
├── example.note        サンプル
├── test_real_article.mjs  全機能統合テスト
└── test_simple.mjs     最小サンプル
```

## セットアップ

### 1. 依存

```bash
npm install
```

(node>=20, `note-api-client` + `image-size` が依存)

### 2. 認証情報

note.com にブラウザでログインし、DevTools → Network タブから以下2つを取得：

- **Cookie**: 任意のリクエストの `Cookie:` ヘッダ全体（`_note_session_v5=...` を含む）
- **x-note-client-code**: 任意のXHRリクエストの Request Header にある64桁のhex

#### 単一アカウント — `.env`

```
NOTE_COOKIES=_note_session_v5=...; fp=...; _ga=...
NOTE_CLIENT_CODE=84c2347630e4eec3...
```

#### 複数アカウント — `accounts.json`

```json
{
  "personal_dev": {
    "email": "...",
    "cookies": "_note_session_v5=...; ...",
    "clientCode": "..."
  },
  "another_account": { ... }
}
```

### 3. 動作確認

```bash
node --env-file=.env test_simple.mjs
```

## クライアント取得

```js
import { getClient, getClientAs } from "./session.mjs";

// .env の NOTE_COOKIES を使う
const client = await getClient();

// accounts.json の名前付きアカウント
const client = await getClientAs("personal_dev");
```

---

# `.note` ファイル形式

Markdown ベース。1ファイルから「下書き保存 / 公開」まで自動。

## 完全シンタックス

```
title:           タイトル                     [必須]
status:          draft | published            (デフォルト draft)
publish_at:      2026-04-25T20:00:00+09:00   (記録用、予約投稿API未対応)
eyecatch:        URL or ローカルパス
price:           300                          (有料記事の価格)
toc:             true                         (目次表示)
description:     SEO概要文
hashtags:        #ADHD, #自己開発              (カンマ/空白区切り)
disable_comment: true                         (UI制御のみ・API未反映)
---

# 大見出し（h2）
## 小見出し（h3）

通常段落

- リスト1
- リスト2

> 引用本文
> 出典: 夏目漱石

```js
コードブロック
```

img: https://example.com/photo.jpg
embed: https://twitter.com/user/status/123
sound: /tmp/song.mp3 | /tmp/cover.jpg | タイトル | アーティスト
attach: /tmp/file.pdf

=== paywall ===

# 有料エリアの見出し
ここから先は有料本文
```

## 実行

```bash
node --env-file=.env post_note_file.mjs example.note
```

`status: published` を書けば自動公開される。書かなければ下書き保存。

---

# API リファレンス

すべて `import { ... } from "./lib/index.mjs"` で取れる。

## 記事 (notes.mjs)

```js
// 作成（空の下書き）
const { id, key } = await createNoteRaw(client, { title });

// 全機能入り下書き保存
await saveDraft(client, {
  noteId, title, body,           // 必須
  index: true,                   // 目次
  eyecatchImageKey,              // アイキャッチ key (uploadImage の返り値)
  separator,                     // 有料境界UUID (paywall.mjs)
  price: 300,                    // 価格
});

// 公開（無料／有料）
await publishNote(client, { noteId, title, body, separator, price, eyecatchImageKey, index });

// 削除
await deleteNote(client, { noteId });    // 公開済記事
await deleteDraft(client, { noteId });   // 下書き
```

## メディア (images.mjs / sounds.mjs)

```js
// アイキャッチ画像（1記事1枚、note_eyecatch endpoint）
const eyecatch = await uploadImage(client, noteId, urlOrPath);
// → { url, key, raw }
// saveDraft に { eyecatchImageKey: eyecatch.key } を渡す

// 本文画像（presigned S3 POST、複数枚OK）
const img = await uploadBodyImage(client, urlOrPath);
// → { url, path, key, width, height }
// elements().figureImg(img.url, "alt", { width, height }) で本文挿入

// 音源プレイヤー（カバー画像必須、1記事に複数可）
const sound = await uploadSound(client, {
  noteKey,
  audioPathOrUrl, coverPathOrUrl,
  title, artistName,
  downloadable: true,
});
// → { key, embedded_content: { key }, play_url, ... }
const html = soundFigure({
  embeddedContentKey: sound.embedded_content.key,
  playUrl: sound.play_url,
  title: sound.title,
});
elements().figureEmbed(html);

// 添付ファイル（PDF / ZIP / mp3 raw etc）
const att = await uploadAttachment(client, { noteKey, filePathOrUrl, fileName });
// → { attachment_key, embedded_content_key, filename, html_for_embed, ... }
const html = attachmentFigure({
  embeddedContentKey: att.embedded_content_key,
  attachmentKey: att.attachment_key,
  filename: att.filename,
});
elements().figureEmbed(html);
```

## SNS埋め込み (embeds.mjs)

```js
// URL → 埋め込み HTML（自動でservice判定）
const html = await embedUrl(client, { noteKey, url: "https://twitter.com/.../status/..." });
elements().figureEmbed(html);

// 個別ステップ
const meta = await registerEmbed(client, { noteKey, url, service: "youtube" });
const html = embedFigure({ url, service, embeddedContentKey: meta.key });
```

対応 service: `twitter / threads / youtube / spotify / instagram / tiktok / vimeo / soundcloud / note / amazon / apple_music`  
動作確認済: ✅ Twitter / Threads / YouTube / Spotify  
失敗例あり: Instagram / TikTok / Vimeo（URL/オーナー設定依存）

## 本文DSL (paywall.mjs)

```js
const e = elements();
e.toc();                              // 目次
e.h2("大見出し");
e.h3("小見出し");
e.p("段落");
e.ul(["a", "b", "c"]);                // 箇条書き
e.blockquote("本文", "出典");          // 引用（出典付き）
e.figureImg(url, "alt", { width, height });  // 本文画像
e.figureEmbed(figureHtml);            // 埋め込み図(任意HTML)
e.raw('<pre><code>...</code></pre>'); // 任意HTML（コードブロック等）

const body = e.array.join("");

// 有料境界の組み立て
const free = elements();
free.h2("無料"); free.p("...");
const pay = elements();
pay.h2("有料"); pay.p("...");
const { body, separator } = buildPaywallBody({ free: free.array, pay: pay.array });
```

## コメント (notes.mjs)

```js
// 一覧
const list = await getCommentList(client, { noteKey });
// 各itemは { key, comment(AST), like_count, reply_count, is_edited, created_at, user, ... }
const text = commentToText(item);

// 投稿（複数行は \n で段落分け）
const r = await postComment(client, { noteKey, message });
// 返信
const r = await replyComment(client, { noteKey, parentKey, message });
// 編集
await editComment(client, { noteKey, commentKey, message });
// 削除
await deleteComment(client, { noteKey, commentKey });
// いいね / 解除
await likeComment(client, { noteKey, commentKey });
await unlikeComment(client, { noteKey, commentKey });
```

**仕様**:
- 1スレッドの最大返信数: **32 (root含めて33件)**。33件目で `400: 返信の上限数を超えました`
- 自分の記事への自己コメント: note.com 仕様で不可（403）

## 記事スキ (notes.mjs)

```js
await likeNote(client, { noteKey });
await unlikeNote(client, { noteKey });
```

## ユーザー / フォロー (users.mjs)

```js
// urlname → 詳細（key含む）
const u = await getUserByUsername(client, { urlname });
// u.key, u.followerCount, u.isFollowing, u.noteCount, ...

// フォロー / アンフォロー（userKey 必要）
await followUser(client, { userKey: u.key, urlname });
await unfollowUser(client, { userKey: u.key, urlname });

// 関連ユーザー (おすすめ)
const list = await getRelatedUsers(client, { urlname });
```

## 統計・売上 (stats.mjs) — 自分のアカウントのみ

```js
// 記事ごとの PV / Like / Comment（自分が公開した記事限定）
const r = await getStatsPv(client, { filter: "all", page: 1, sort: "pv" });
// → r.data.note_stats[] = [{ key, name, read_count(=PV), like_count, comment_count, status, ... }]
// → r.data.total_pv / total_like / total_comment

// 全ページ取得
const all = await getStatsAll(client, { filter: "all", sort: "pv" });

// 購入者一覧（売上履歴）
const r = await getPurchasers(client, { page: 1 });
// → r.data.purchasers[] = [{ price, purchased_at, is_refund, content: {key, name}, user: {urlname, nickname}, ... }]

// 全件
const list = await getPurchasersAll(client);
const revenue = list.filter(p => !p.is_refund).reduce((s, p) => s + p.price, 0);
```

`sort` 候補: `pv` / `like` / `comment` / `publish_at` 等  
`filter` 候補: `all` / 未確認

## ユーザー / フォロー (users.mjs)

```js
// urlname → 詳細（key含む）
const u = await getUserByUsername(client, { urlname });
// u.key, u.followerCount, u.isFollowing, u.noteCount, u.profile, ...

// フォロー / アンフォロー
await followUser(client, { userKey: u.key, urlname });
await unfollowUser(client, { userKey: u.key, urlname });

// 関連ユーザー（おすすめ）
const list = await getRelatedUsers(client, { urlname });

// 他人のフォロワー / フォロー中（公開情報、API上限600件）
const fr = await getFollowers(client, { urlname, page: 1 });
// → { follows: [...], totalCount, isLastPage }
const fl = await getFollowings(client, { urlname, page: 1 });

// 全ページ（最大600件まで）
const followers = await getFollowList(client, { urlname, kind: "followers" });
const followings = await getFollowList(client, { urlname, kind: "followings" });
```

各 follow エントリ: `{ urlname, nickname, key, followerCount, isFollowing, profile, userProfileImagePath, ... }`

## 検索 (search.mjs)

```js
const r = await search(client, { q: "キーワード", context: "note", size: 20, start: 0 });
// → { items, isLastPage, totalCount, raw }

// 全ページ
const all = await searchAll(client, { q: "副業", context: "note", maxPages: 5 });
```

context: `note / user / magazine / hashtag / circle / noteForSale`

## 認証ヘッダ (auth.mjs)

```js
// origin/referer をデフォルト「note.com」で生成
authHeaders(client);

// 埋め込み登録など editor.note.com origin が必要なケース
authHeaders(client, { referer: "https://editor.note.com/", origin: "https://editor.note.com" });

// multipart 用に Content-Type: application/json を付けない
authHeaders(client, { json: false });
```

---

# 動作確認済 vs 未確認

## ✅ 完全API化

- 記事: 作成 / 下書き / 公開 / 削除（無料・有料両対応）
- メディア: アイキャッチ / 本文画像 / 音源 / 添付ファイル / SNS埋め込み
- 有料エリア: separator方式
- 目次 / コードブロック / 引用（出典付き）
- コメント: 一覧 / 投稿 / 返信 / 編集 / 削除 / いいね / 解除
- 記事スキ / 解除
- フォロー / アンフォロー / 関連ユーザー / **他人のフォロワー・フォロー中一覧**
- 検索 (記事 / ユーザー / ハッシュタグ等)
- **統計**: 自記事のPV / Like / Comment、**売上履歴・購入者一覧**
- マルチアカウント切替
- `.note` ファイル形式

## 🟡 部分API（一部UI依存）

- ハッシュタグ: 本文に `#tag` 埋めて自動認識（公式仕様）
- description（SEO概要）: API側エンドポイント未特定、`.note`ではメタ保存のみ
- 予約投稿（publish_at）: API未特定、`.note`ではメタ保存のみ
- コメント無効化: API未特定

## ❌ 非対応

- マガジン操作（追加・削除・作成）: 別途必要なら追加可
- スライド/コミック: 一旦スコープ外
- 通知一覧 / ダッシュボード分析: 別途必要なら追加可

## 🛡️ セキュリティで意図的に不可

- **未購入の有料記事の全文取得**: サーバー側で paywall フィルタ強制（API操作で迂回不可）
- **無料での購入扱い**: 決済プロセッサ連携必須、Cookie偽装等で突破不可
- **自己購入**: `is_my_note: true` の記事への購入APIは 404 で隠蔽
- **JWT偽造**: `note_gql_auth_token` は note.com の秘密鍵で署名

---

# 既知の制約・落とし穴

| 項目 | 制約 |
|---|---|
| ライブラリの `uploadEyecatch` | Content-Type バグで500。自前 `uploadImage` を使う |
| ライブラリの `editNote` | `status: "published"` ハードコード→呼ぶと公開される |
| 検索 / 公開API の `note_gql_auth_token` JWT | 30分で期限切れ、必要なら再キャプチャ |
| `note_eyecatch` エンドポイント | 1記事1枚のみ。2回目で error |
| テーブル `<table>` | note.com 側で剥がされる仕様 |
| 返信スレッド深さ | 1スレッド最大32返信 |
| signIn 系（library標準） | レート制限が早い。Cookie流用方式が安定 |

---

# .note 例（フル装備）

```
title: ADHDグレーの僕が夜を変えたら睡眠の質が2倍になった
status: published
eyecatch: https://example.com/cover.jpg
price: 300
toc: true
hashtags: #ADHD, #自己開発, #睡眠
description: 夜の3つの習慣を変えただけで深い睡眠が2倍になった話。
---

# 「また眠れない」を3年繰り返していた話

ADHDグレーの僕は、ベッドで1〜2時間スマホを触る生活が常態化してました。

> 睡眠の質は「朝の使い方」ではなく「夜22時以降の選択」で決まる。
> 出典: Matthew Walker『Why We Sleep』

img: /tmp/sleep-graph.jpg
embed: https://twitter.com/ren_adhd/status/2047185530417529186

=== paywall ===

# 僕が変えた夜の3つのこと

## 1. 21時にスマホを別室に置く
ADHDの脳は「目に入る＝開く」になりがち。

```json
{ "deep_sleep": 78, "total": 443 }
```

sound: /tmp/bgm.mp3 | /tmp/cover.jpg | 寝る前BGM | 自分

# まとめ

> 小さく始めろ。続くものだけが効く。
> 出典: 自分
```
