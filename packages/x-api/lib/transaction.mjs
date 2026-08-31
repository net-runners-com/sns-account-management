// x-client-transaction-id 生成 (process 内 singleton).
// search.mjs / follows.mjs は各自ローカルに同じものを持っている. 新規コードはこちらを使う.
import { ClientTransaction, handleXMigration } from "x-client-transaction-id";

let _gen = null;
export async function getTransactionGen() {
  if (_gen) return _gen;
  const document = await handleXMigration();
  _gen = await ClientTransaction.create(document);
  return _gen;
}

export async function generateTransactionId(method, urlPath) {
  const gen = await getTransactionGen();
  return await gen.generateTransactionId(method, urlPath);
}
