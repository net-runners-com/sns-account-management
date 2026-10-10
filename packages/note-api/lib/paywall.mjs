// 有料エリア (paywall) ヘルパー
//
// 仕組み: body は free + pay を1本のHTMLとして書く。その中で有料エリア開始位置の要素の
//   name/id (UUID) を saveDraft の separator フィールドに渡す。
//   note.com はその要素から先を有料エリアとしてレンダリングする。
//
// 使い方:
//   1. freeBody と payBody を用意
//   2. buildPaywallBody({ free, pay }) で 1本化＋境界UUID取得
//   3. saveDraft({ ..., body, separator, price }) で保存

import crypto from "crypto";

// free/pay を HTML 配列で受け取り、1本の body と separator UUID を返す
// - free: HTML文字列の配列（各要素は既に UUID 付与済の想定でもOK、なくてもOK）
// - pay:  同上
// 最終的に free[] + (separator要素) + pay[] の順で並ぶ
// separator 要素は pay[0] の先頭要素に埋め込まれる（新規<h2 /><p />...）
// → payArr[0] の name/id UUID を取り出して separator に使う
export function buildPaywallBody({ free, pay }) {
  if (!Array.isArray(free) || !Array.isArray(pay)) {
    throw new Error("free と pay は配列で渡してください (HTML文字列の配列)");
  }
  if (pay.length === 0) throw new Error("pay は最低1要素必要");

  // pay[0] から id="..." を抜き出して separator にする
  const m = pay[0].match(/id="([0-9a-f-]{36})"/);
  if (!m) {
    throw new Error("pay[0] に id='UUID' 属性が必要。elements ヘルパー等で UUID 付き要素を作ってください。");
  }
  const separator = m[1];
  const body = free.concat(pay).join("");
  return { body, separator };
}

// 要素ファクトリ: HTML要素の配列を簡単に組み立てるヘルパ
// 使用例:
//   const f = elements();
//   f.h2("タイトル");
//   f.p("本文");
//   f.toc();
//   const html = f.array; // 配列としてbuildPaywallBodyに渡せる
export function elements() {
  const uuid = () => crypto.randomUUID();
  const arr = [];
  const add = (t, tag) => { arr.push(t); return { id: tag };};
  return {
    get array() { return arr; },
    p(text)   { const id=uuid(); arr.push(`<p name="${id}" id="${id}">${text}</p>`); return id; },
    h2(text)  { const id=uuid(); arr.push(`<h2 name="${id}" id="${id}">${text}</h2>`); return id; },
    h3(text)  { const id=uuid(); arr.push(`<h3 name="${id}" id="${id}">${text}</h3>`); return id; },
    toc()     { const id=uuid(); arr.push(`<table-of-contents name="${id}" id="${id}"><br></table-of-contents>`); return id; },
    ul(items) { const id=uuid(); const lis = items.map(it => { const iid=uuid(); return `<li name="${iid}" id="${iid}">${it}</li>`; }).join(""); arr.push(`<ul name="${id}" id="${id}">${lis}</ul>`); return id; },
    // 引用ブロック: figure > blockquote > p + figcaption(出典) の構造
    // source を省略すれば出典なし
    blockquote(text, source = "") {
      const figId = uuid();
      const pId = uuid();
      arr.push(`<figure name="${figId}" id="${figId}"><blockquote><p name="${pId}" id="${pId}">${text}</p></blockquote><figcaption>${source}</figcaption></figure>`);
      return figId;
    },
    // note.com 準拠: width=620 に正規化 + contenteditable/draggable 属性 + 空figcaption
    figureImg(src, alt = "", { width, height, caption = "" } = {}) {
      const id = uuid();
      // note.com は幅620固定 / 高さはアスペクト比でスケール
      let w = 620, h;
      if (width && height) {
        h = Math.round((height / width) * 620);
      }
      const dim = h ? ` width="${w}" height="${h}"` : ` width="${w}"`;
      arr.push(`<figure name="${id}" id="${id}"><img src="${src}" alt="${alt}"${dim} contenteditable="false" draggable="false"><figcaption>${caption}</figcaption></figure>`);
      return id;
    },
    figureEmbed(figureHtml) { arr.push(figureHtml); },  // embeds.mjs#embedFigure の結果を貼る用
    raw(html) { arr.push(html); },
  };
}
