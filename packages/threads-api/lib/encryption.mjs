// Threads/Instagram の enc_password 生成 + jazoest 計算
//
// enc_password 形式: #PWD_BROWSER:<key_version>:<unix_ts>:<base64(payload)>
// payload バイト列:   [0x01][key_id 1B][sealed_len LE 2B][sealed 80B][gcm_tag 16B][ciphertext NB]
//   sealed: NaCl crypto_box_seal(session_key=32B, server_pub_key) → 32(eph_pub) + 48(暗号文+poly1305) = 80B
//   AES-256-GCM: key=session_key, IV=12 zero bytes, AAD=timestamp 文字列, plaintext=password
import { createCipheriv, randomBytes } from "crypto";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
// libsodium-wrappers の ESM ビルドは sibling package の libsodium.mjs を解決できない
// バグがあるので CJS 経由で取り込む
const sodiumLib = require("libsodium-wrappers");
const sodiumReady = sodiumLib.ready.then(() => sodiumLib);

// 同梱の seed pub key. accounts.json._encryption が空のとき初回 login に使う.
// 古くても server が rotate して新値返してくれるので問題ない (refresh_session.mjs の rotation handler で
// 自動更新される). 全0は libsodium が curve point として reject するため、有効な X25519 key が必要.
export const SEED_ENCRYPTION = {
  _comment: "ライブラリ同梱の seed. server が rotate したら自動で最新値に更新される.",
  pubKeyHex: "4d51c921de130708eca656a7a9e76d2c647f846cb57ef7412900845e4e113f55",
  keyId: 44,
  keyVersion: 10,
};

export async function encryptPassword({ password, pubKeyHex, keyId, keyVersion, timestamp }) {
  const sodium = await sodiumReady;
  const sessionKey = randomBytes(32);
  const iv = Buffer.alloc(12, 0);
  const ts = timestamp ?? Math.floor(Date.now() / 1000).toString();

  const pubKey = Buffer.from(pubKeyHex, "hex");
  const sealed = Buffer.from(sodium.crypto_box_seal(sessionKey, pubKey));
  if (sealed.length !== 80) throw new Error(`sealed length unexpected: ${sealed.length}`);

  const cipher = createCipheriv("aes-256-gcm", sessionKey, iv);
  cipher.setAAD(Buffer.from(ts, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(password, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  const payload = Buffer.concat([
    Buffer.from([1, keyId & 0xff]),
    Buffer.from([sealed.length & 0xff, (sealed.length >> 8) & 0xff]),
    sealed,
    tag,
    ciphertext,
  ]);

  return {
    encPassword: `#PWD_BROWSER:${keyVersion}:${ts}:${payload.toString("base64")}`,
    timestamp: ts,
  };
}

export function computeJazoest(input) {
  let sum = 0;
  for (let i = 0; i < input.length; i++) sum += input.charCodeAt(i);
  return "2" + sum.toString();
}
