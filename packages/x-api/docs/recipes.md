# Recipes

よくあるタスクの生コード。

> **データ保存について**: 全 CLI はデフォルトで `<package>/data/<account>/` に JSON 保存する（タイムスタンプ付き filename）。`--no-save` で抑制、`--save-dir <path>` でパス変更、`X_DATA_PATH` env で全 CLI のデフォルト変更。

---

## 1. アカウント追加 (新規ログイン)

```bash
# claude code 経由なら AGENTS.md §2 のハンドシェイク手順。
# 単体なら:
node login_browser.mjs --account my_account &
# ブラウザでログイン後
touch /tmp/x_login_my_account.ready
```

---

## 2. プロフィール取得

### CLI
```bash
node profile.mjs --account my_account --screen-name elonmusk
node profile.mjs --account my_account --user-id 44196397
node profile.mjs --account my_account --screen-name elonmusk --raw  # 生 JSON
```

### プログラム
```js
import { getAccount, getProfileByScreenName } from "./lib/index.mjs";

const acc = getAccount("my_account");
const p = await getProfileByScreenName(acc, { screenName: "elonmusk" });
console.log(p.followers_count, p.statuses_count);
```

---

## 3. 全投稿アーカイブ

### CLI (1000 件まで、JSON で保存)
```bash
node posts.mjs --account my_account --screen-name elonmusk --max-pages 25 --json > musk.json
```

### プログラム (page ごとに DB に書く)
```js
import { getAccount, getProfileByScreenName, getAllUserTweets } from "./lib/index.mjs";

const acc = getAccount("my_account");
const profile = await getProfileByScreenName(acc, { screenName: "elonmusk" });

const all = await getAllUserTweets(acc, {
  userId: profile.user_id,
  accountName: "my_account",
  maxPages: 50,
  onPage: (tweets, page) => {
    console.error(`[page ${page}] +${tweets.length}`);
    // ここで DB insert 等
  },
});
console.log(`total: ${all.length}`);
```

---

## 4. キーワード検索 (Latest)

### CLI
```bash
node search.mjs --account my_account --q "Claude Code" --product Latest --max-pages 5 --json
```

### プログラム
```js
import { getAccount } from "./lib/index.mjs";
import { searchAll } from "./lib/search.mjs";

const acc = getAccount("my_account");
const tweets = await searchAll(acc, {
  query: "Claude Code lang:ja -filter:replies",
  product: "Latest",
  accountName: "my_account",
  maxPages: 10,
});
console.log(`hits: ${tweets.length}`);
```

---

## 5. ユーザー検索

```js
import { searchAll } from "./lib/search.mjs";

const users = await searchAll(acc, {
  query: "AI engineer",
  product: "People",
  accountName: "my_account",
  maxPages: 3,
});
// users[i] は profile object
```

---

## 6. フォロー / フォロワー一覧

### CLI
```bash
node follows.mjs --account my_account --screen-name target --type following --max-pages 10 --json
node follows.mjs --account my_account --screen-name target --type followers --max-pages 10 --json
```

### プログラム
```js
import { getProfileByScreenName } from "./lib/index.mjs";
import { getAllFollowing } from "./lib/follows.mjs";

const profile = await getProfileByScreenName(acc, { screenName: "target" });
const followings = await getAllFollowing(acc, {
  userId: profile.user_id,
  accountName: "my_account",
  maxPages: 20,
});
```

---

## 7. セッション確認 + 自動再ログイン (パイプライン頭で)

```js
import { isSessionAlive, getAccount } from "./lib/index.mjs";
import { reloginAccount } from "./lib/index.mjs";

const NAME = "my_account";
if (!await isSessionAlive(NAME)) {
  console.error("[boot] session dead, attempting relogin...");
  await reloginAccount(NAME);  // env credentials が必要
}
const acc = getAccount(NAME);
// 以降このタスクで使う
```

---

## 8. 同一クエリで重複フォローしてる人を見つける (実用例)

```js
import { getAccount } from "./lib/index.mjs";
import { searchAll } from "./lib/search.mjs";
import { getAllFollowing } from "./lib/follows.mjs";

const acc = getAccount("my_account");

// 1. クエリでヒットした人を集める
const tweets = await searchAll(acc, { query: "Claude Code", product: "Latest", accountName: "my_account", maxPages: 10 });
const tweetAuthors = new Set(tweets.map(t => t.author.user_id));

// 2. 自分のフォロー一覧
const me = await getAccount("my_account");
const myFollowings = await getAllFollowing(acc, { userId: me.user_id, accountName: "my_account", maxPages: 20 });
const followingIds = new Set(myFollowings.map(u => u.user_id));

// 3. 「クエリでヒット + 自分フォロー済み」の交差
const overlap = [...tweetAuthors].filter(id => followingIds.has(id));
console.log(`overlap: ${overlap.length}`);
```

---

## 9. エラーをトレースしやすくする

```js
import { XSessionError, formatSessionErrorForCLI } from "./lib/index.mjs";

try {
  await someTask();
} catch (e) {
  if (e instanceof XSessionError) {
    console.error(formatSessionErrorForCLI(e));
    // → 「session expired (code 32). run: node login_browser.mjs --account my_account」みたいに見せられる
    process.exit(2);
  }
  throw e;
}
```

---

## 10. 別マシンへ持って行く時

```bash
# 元マシン
cd packages/x-api
tar czf /tmp/x-api-bundle.tar.gz --exclude node_modules .
# 受け側へコピー後
tar xzf x-api-bundle.tar.gz -C ./x-api-package
cd x-api-package && npm install
node login_browser.mjs --account my_account
```

`accounts/x_accounts.json` は機密データなのでバンドルに含めない。受け側で再ログイン。
