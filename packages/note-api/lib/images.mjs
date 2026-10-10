// 画像アップロード
// ライブラリの uploadEyecatch は Content-Type バグで500になるので生APIで実装。
// アイキャッチと本文画像の両方に使える（本文画像は <figure><img src="返却URL"></figure> で埋め込み）
//
// note の note_eyecatch エンドポイントは form の width/height を必須とする。
// 寸法が取れず "undefined" を送ると 400 "width is invalid, height is invalid" で失敗するため、
// image-size → sips フォールバックの順で実寸を確実に取得し、取れなければ明確なエラーを投げる。
// (寸法・ファイルサイズ自体に実用上の上限は無く 20000px/17MB でも 201。失敗は常に寸法不明が原因。)

import { authHeaders } from "./auth.mjs";

export async function uploadImage(client, noteId, imagePathOrUrl) {
  const { buf } = await loadImageBuffer(imagePathOrUrl);
  const mime = detectMime(buf);
  const dims = await getDims(buf);
  assertDims(dims, imagePathOrUrl);

  const form = new FormData();
  form.append("note_id", String(noteId));
  form.append("file", new Blob([buf], { type: mime }), "blob");
  form.append("width", String(dims.width));
  form.append("height", String(dims.height));

  const res = await fetch("https://note.com/api/v1/image_upload/note_eyecatch", {
    method: "POST",
    body: form,
    headers: authHeaders(client, { json: false }),
  });
  if (!res.ok) throw new Error(`upload failed ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const url = json?.data?.url;
  return { url, key: extractImageKey(url), raw: json };
}

// 本文画像アップロード (presigned S3 POST方式)
//   1. /api/v3/images/upload/presigned_post でS3プリサインドフィールド取得
//   2. S3 に直接 POST
//   3. 公開URL を返す (note.com 編集画面で画像を貼ったときと同じ流れ)
// 使い方:
//   const { url } = await uploadBodyImage(client, imagePathOrUrl);
//   elements().figureImg(url, "alt text");   // body に埋め込み
export async function uploadBodyImage(client, imagePathOrUrl) {
  const { buf, filename } = await loadImageBuffer(imagePathOrUrl);
  const mime = detectMime(buf);
  const dims = await getDims(buf);
  assertDims(dims, imagePathOrUrl);

  // ① presigned 取得
  const r1 = await fetch("https://note.com/api/v3/images/upload/presigned_post", {
    method: "POST",
    body: JSON.stringify({ filename, content_type: mime, size: buf.length }),
    headers: authHeaders(client, { referer: "https://editor.note.com/", origin: "https://editor.note.com" }),
  });
  if (!r1.ok) throw new Error(`presigned_post failed ${r1.status}: ${await r1.text()}`);
  const { url, path, action, post } = (await r1.json()).data;

  // ② S3に直接アップロード
  const form = new FormData();
  for (const [k, v] of Object.entries(post)) form.append(k, String(v));
  form.append("file", new Blob([buf], { type: mime }), filename);
  const r2 = await fetch(action, { method: "POST", body: form });
  if (r2.status < 200 || r2.status >= 300) {
    throw new Error(`S3 upload failed ${r2.status}: ${await r2.text()}`);
  }

  // key は URL末尾ファイル名から拡張子を除いたもの
  const key = path.split("/").pop().replace(/\.[^.]+$/, "");
  return { url, path, key, width: dims.width, height: dims.height };
}

// 返却URLの末尾から image key を抽出
// 例: .../rectangle_large_type_2_<HEX>.jpeg → <HEX>
export function extractImageKey(url) {
  if (!url) return null;
  const filename = url.split("/").pop().split("?")[0];
  const noExt = filename.replace(/\.[^.]+$/, "");
  return noExt.replace(/^rectangle_large_type_\d+_/, "");
}

// 画像を Buffer として取得する。
// リモートURLは res.ok と「実際に画像が返ったか」を検証し、HTML/エラー応答を弾く
// (note 側で 400 になる前に分かりやすく落とすため)。
async function loadImageBuffer(imagePathOrUrl) {
  if (/^https?:\/\//.test(imagePathOrUrl)) {
    const res = await fetch(imagePathOrUrl, { redirect: "follow" });
    if (!res.ok) {
      throw new Error(`eyecatch fetch failed ${res.status} for URL: ${imagePathOrUrl}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const ct = res.headers.get("content-type") || "";
    if (!looksLikeImage(buf)) {
      throw new Error(
        `eyecatch URL が画像を返しませんでした (content-type=${ct || "?"}, ${buf.length} bytes)。` +
        `URL がエラーページ/リダイレクト/レート制限を返した可能性があります: ${imagePathOrUrl}`
      );
    }
    const filename = (imagePathOrUrl.split("/").pop() || "image.jpg").split("?")[0] || "image.jpg";
    return { buf, filename };
  }
  const { readFileSync } = await import("fs");
  const buf = readFileSync(imagePathOrUrl);
  return { buf, filename: imagePathOrUrl.split("/").pop() || "image.jpg" };
}

function looksLikeImage(buf) {
  if (!buf || buf.length < 12) return false;
  if (buf[0] === 0x89 && buf[1] === 0x50) return true; // PNG
  if (buf[0] === 0xff && buf[1] === 0xd8) return true; // JPEG
  if (buf[0] === 0x47 && buf[1] === 0x49) return true; // GIF
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf.toString("ascii", 8, 12) === "WEBP") return true; // WEBP (RIFF....WEBP)
  if (buf.toString("ascii", 4, 8) === "ftyp") return true; // HEIC / AVIF
  if (buf[0] === 0x42 && buf[1] === 0x4d) return true; // BMP
  return false;
}

function detectMime(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf[0] === 0x47 && buf[1] === 0x49) return "image/gif";
  if (buf[0] === 0x52 && buf[1] === 0x49) return "image/webp";
  return "image/jpeg";
}

function validDims(d) {
  return d && Number.isInteger(d.width) && Number.isInteger(d.height) && d.width > 0 && d.height > 0;
}

function assertDims(dims, src) {
  if (!validDims(dims)) {
    throw new Error(
      `画像の寸法を取得できませんでした (width=${dims?.width}, height=${dims?.height})。` +
      `画像が壊れている / 画像でない / 未対応フォーマットの可能性があります。` +
      `source: ${typeof src === "string" ? src.slice(0, 160) : "<buffer>"}`
    );
  }
}

// 実寸を取得する。image-size が失敗/未定義を返すケースに備えて sips にフォールバックする。
async function getDims(buf) {
  try {
    const sizeOf = (await import("image-size")).default;
    const d = sizeOf(buf);
    if (validDims(d)) return { width: d.width, height: d.height };
  } catch {
    // image-size がパースできない → sips フォールバックへ
  }
  const viaSips = await dimsViaSips(buf);
  if (viaSips) return viaSips;
  return { width: undefined, height: undefined };
}

// macOS の sips で実寸を読む (HEIC/WebP/特殊JPEG 等 image-size が苦手な変種向け)。
async function dimsViaSips(buf) {
  try {
    const { execFileSync } = await import("child_process");
    const { writeFileSync, rmSync } = await import("fs");
    const { tmpdir } = await import("os");
    const { join } = await import("path");
    const tmp = join(tmpdir(), `note_ec_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    writeFileSync(tmp, buf);
    try {
      const out = execFileSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", tmp], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      const w = /pixelWidth:\s*(\d+)/.exec(out)?.[1];
      const h = /pixelHeight:\s*(\d+)/.exec(out)?.[1];
      if (w && h) return { width: Number(w), height: Number(h) };
    } finally {
      try { rmSync(tmp); } catch {}
    }
  } catch {
    // sips が無い/失敗 → 呼び出し側で undefined 判定して明確に throw
  }
  return null;
}
