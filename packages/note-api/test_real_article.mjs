// 実用想定の総合統合テスト
// 「ADHDグレーの僕が"夜を変えたら"睡眠の質が2倍になった」想定の記事を、
// 全機能（アイキャッチ+目次+コードブロック+画像+SNS埋め込み+有料エリア）使って組み立て
import { getClient } from "./session.mjs";
import {
  createNoteRaw,
  saveDraft,
  uploadImage,
  uploadBodyImage,
  buildPaywallBody,
  elements,
  embedUrl,
} from "./lib/index.mjs";

const client = await getClient();

const title = `[FULL-ARTICLE] ADHDグレーの僕が"夜を変えたら"睡眠の質が2倍になった`;

// 1) 記事作成 → noteKey 取得
console.log("1) createNote...");
const { id: noteId, key: noteKey } = await createNoteRaw(client, { title });
console.log(`   noteId=${noteId} noteKey=${noteKey}`);

// 2) アイキャッチ
console.log("2) アイキャッチ画像アップロード...");
const eyecatch = await uploadImage(client, noteId, "https://picsum.photos/seed/sleep_article/1280/670.jpg");
console.log(`   key=${eyecatch.key}`);

// 3) 本文画像（presigned_post 経由でアップロード）
console.log("3) 本文画像アップロード (presigned_post)...");
const bodyImg = await uploadBodyImage(client, "https://picsum.photos/seed/graph2/800/500.jpg");
console.log(`   url=${bodyImg.url}`);
console.log(`   dims=${bodyImg.width}x${bodyImg.height}`);

// 4) SNS埋め込み（4種類）
console.log("4) SNS埋め込み登録...");
const embedDefs = [
  ["twitter",  "https://twitter.com/ren_adhd/status/2047185530417529186"],
  ["threads",  "https://www.threads.com/@ren_adhd_asd/post/DXdl4ZhEeFE"],
  ["youtube",  "https://www.youtube.com/watch?v=jNQXAC9IVRw"],
  ["spotify",  "https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh"],
];
const embeds = {};
for (const [svc, url] of embedDefs) {
  const html = await embedUrl(client, { noteKey, url, service: svc });
  if (html) embeds[svc] = html;
  console.log(`   ${svc}: ${html ? "OK" : "NG"}`);
}

// 5) 無料エリア構築
console.log("5) 本文組み立て...");
const free = elements();
free.toc();

free.h2("「また眠れない」を3年繰り返していた話");
free.p("ADHDグレーの僕は、ベッドに入ってから1〜2時間スマホを触り続ける生活が当たり前でした。");
free.p("起きるのは10時。土日はもっとひどい。週明けの体調が最悪で、月曜の生産性は半分以下でした。");
free.p("睡眠改善の本は10冊以上読んだ。瞑想アプリも入れた。なのに何ひとつ続かない。");
// 自分のツイートを引用
if (embeds.twitter) free.figureEmbed(embeds.twitter);

free.h2("結論：朝じゃなくて「夜」を変えた");
free.p("僕に効いたのは朝活でも瞑想でもなく、夜の3つの小さな変化でした。");
free.blockquote("睡眠の質は「朝の使い方」ではなく「夜22時以降の選択」で決まる。", "Matthew Walker『Why We Sleep』");

free.h2("睡眠ログを30日測ったら、こうなった");
free.p("Apple Watch の睡眠ステージで、夜の習慣を3つ変える前後を比較。深い睡眠が 38分 → 78分 になりました。");
free.figureImg(bodyImg.url, "睡眠ログ", { width: bodyImg.width, height: bodyImg.height });

free.h2("同じテーマを Threads でも書いてます");
if (embeds.threads) free.figureEmbed(embeds.threads);

free.h2("この記事で書くこと");
free.p("ここから先で、その「夜の3つの変化」を全部書きます。");
free.ul([
  "変えた3つの具体ポイント",
  "Apple Watchログの生データ（Before/After）",
  "詰まったときの対処法",
  "使ったツール・照明スペック",
]);

// 6) 有料エリア（separator になる h2 が pay[0]）
const pay = elements();
pay.h2("僕が変えた「夜の3つのこと」"); // ← separator
pay.p("順番に書きます。効果が大きかった順です。");

pay.h3("1. 21時にスマホを別室に置く");
pay.p("ADHDの脳は「目に入る＝開く」になりがちです。物理的に取れない位置にすると、SNS無限スクロールが消えます。");
pay.p("コツ: 充電器ごと別室に移す。最初の3日は禁断症状が出ますが1週間で慣れます。");

pay.h3("2. 22時以降の照明を3000K未満に統一");
pay.ul([
  "リビング: 電球色LED 3000K",
  "寝室: 2700K",
  "洗面所: 2700K",
]);
pay.p("光環境を「夜モード」に揃えると、メラトニン分泌のタイミングが安定します。合計4000円程度の投資で済みます。");

pay.h3("3. 寝る前に「明日のひとつ」だけメモ");
pay.p("ADHDの僕は未完了タスクが暴れて眠れない。就寝前に紙のノートに「明日いちばん最初にやること」を1個だけ書く。それだけ。");
// コードブロック（ログのフォーマット例）
pay.raw(`<pre name="code-log" id="code-log"><code>{
  "2026-04-20": { "deep_sleep": 78, "total": 443 },
  "2026-04-21": { "deep_sleep": 82, "total": 455 }
}</code></pre>`);

pay.h2("Before / After の数字");
pay.ul([
  "深い睡眠平均: 38分 → 78分",
  "総睡眠時間: 5h42m → 6h28m",
  "寝付きまでの時間: 42分 → 11分",
]);

pay.h2("YouTube で解説版もあげてます");
if (embeds.youtube) pay.figureEmbed(embeds.youtube);

pay.h2("寝る前BGM（個人的定番）");
if (embeds.spotify) pay.figureEmbed(embeds.spotify);

pay.h2("詰まったときの対処法");
pay.p("1週目でスマホ別室に挫折したら、寝室の入口に小さいカゴを置いて「ベッド手前で止まる」関門を作るのがオススメです。");

pay.h2("まとめ");
pay.blockquote("小さく始めろ。続くものだけが効く。", "自分");
pay.p("朝じゃなく「夜」を変える。ADHDグレーの僕でもできた、というところがこの話の本体です。");

// 7) 結合 + 有料境界抽出
const { body, separator } = buildPaywallBody({ free: free.array, pay: pay.array });
console.log(`   body(タグ除): ${body.replace(/<[^>]*>/g,"").length}文字`);
console.log(`   separator: ${separator}`);

// 8) 保存（下書きのまま）
console.log("6) saveDraft...");
await saveDraft(client, {
  noteId,
  title,
  body,
  index: true,
  eyecatchImageKey: eyecatch.key,
  separator,
  price: 300,
  pictures: [bodyImg],
});

console.log(`\n✓ 保存完了`);
console.log(`  noteId:  ${noteId}`);
console.log(`  noteKey: ${noteKey}`);
console.log(`  edit URL: https://editor.note.com/notes/${noteKey}/edit/`);
console.log(`\n→ note.com 下書き「${title}」を開いて確認:`);
console.log("  ☐ アイキャッチ画像が設定 (睡眠イメージ)");
console.log("  ☐ 目次に h2 10項目くらい");
console.log("  ☐ 無料エリアに Twitter / Threads / 本文画像が表示");
console.log("  ☐ 「僕が変えた「夜の3つのこと」」の直前に有料セパレーター");
console.log("  ☐ 有料エリアに YouTube / Spotify / コードブロックが表示");
console.log("  ☐ 価格 300円");
