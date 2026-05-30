"""ハイブリッド検索＋リランク。
  1) FTS5 trigram × sqlite-vec を重み付きRRFで融合 → 候補生成
  2) small-to-large で前後を含む文脈に拡張
  3) cross-encoder(bge-reranker) で本当の関連度に並べ直す
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import argparse
import json

import config
import db
from embed import Embedder
from sqlite_vec import serialize_float32

_embedder = None
_reranker = None


def _get_embedder(conn):
    global _embedder
    if _embedder is None:
        _embedder = Embedder(db.get_meta(conn, "embed_model", config.EMBED_MODEL))
    return _embedder


def _get_reranker():
    global _reranker
    if _reranker is None:
        from rerank import Reranker
        _reranker = Reranker()
    return _reranker


def _fts(conn, query, n):
    q = '"' + query.replace('"', '""') + '"'
    try:
        rows = conn.execute(
            "SELECT chunk_id FROM fts_chunks WHERE fts_chunks MATCH ? ORDER BY rank LIMIT ?",
            (q, n),
        ).fetchall()
    except Exception:
        return []
    return [r["chunk_id"] for r in rows]


def _vec(conn, query, n):
    try:
        v = _get_embedder(conn).embed([query])[0]
        rows = conn.execute(
            "SELECT chunk_id FROM vec_chunks WHERE embedding MATCH ? ORDER BY distance LIMIT ?",
            (serialize_float32(v.tolist()), n),
        ).fetchall()
    except Exception:
        return []
    return [r["chunk_id"] for r in rows]


def _expand(conn, chunk_id, window):
    row = conn.execute(
        "SELECT c.doc_id, c.ord, c.heading, d.path, d.title, d.folder "
        "FROM chunks c JOIN documents d ON c.doc_id=d.doc_id WHERE c.chunk_id=?",
        (chunk_id,),
    ).fetchone()
    if not row:
        return None
    parts = conn.execute(
        "SELECT content FROM chunks WHERE doc_id=? AND ord BETWEEN ? AND ? ORDER BY ord",
        (row["doc_id"], row["ord"] - window, row["ord"] + window),
    ).fetchall()
    return {
        "path": row["path"], "title": row["title"], "folder": row["folder"],
        "heading": row["heading"], "content": "\n".join(p["content"] for p in parts),
    }


def search(query, k=8, folder=None, rerank=None):
    """rerank: None=設定に従う / True / False"""
    use_rerank = config.RERANK_ENABLED if rerank is None else rerank
    conn = db.connect()
    n = config.CANDIDATES

    # 1) ハイブリッド候補生成（RRF）
    scores = {}
    for rank, cid in enumerate(_fts(conn, query, n)):
        scores[cid] = scores.get(cid, 0) + config.W_FTS / (config.RRF_K + rank + 1)
    for rank, cid in enumerate(_vec(conn, query, n)):
        scores[cid] = scores.get(cid, 0) + config.W_VEC / (config.RRF_K + rank + 1)

    # 2) 拡張＋重複除去（path+heading 単位）
    candidates, seen = [], set()
    for cid in sorted(scores, key=lambda c: -scores[c]):
        exp = _expand(conn, cid, config.CONTEXT_WINDOW)
        if not exp or (folder and exp["folder"] != folder):
            continue
        key = (exp["path"], exp["heading"])
        if key in seen:
            continue
        seen.add(key)
        exp["rrf"] = round(scores[cid], 6)
        candidates.append(exp)
        if len(candidates) >= config.RERANK_CANDIDATES:
            break
    conn.close()

    # 3) リランク（cross-encoder）
    if use_rerank and candidates:
        passages = [f"{c['title']} {c['heading']} {c['content']}" for c in candidates]
        rscores = _get_reranker().score(query, passages)
        for c, s in zip(candidates, rscores):
            c["score"] = round(s, 5)
        candidates.sort(key=lambda c: -c["score"])
    else:
        for c in candidates:
            c["score"] = c["rrf"]

    return candidates[:k]


def main():
    ap = argparse.ArgumentParser(description="search the vault")
    ap.add_argument("query")
    ap.add_argument("-k", type=int, default=8)
    ap.add_argument("--folder", default=None, help="knowledge|research|accounts|prompts")
    ap.add_argument("--no-rerank", action="store_true")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    res = search(a.query, k=a.k, folder=a.folder, rerank=not a.no_rerank)
    if a.json:
        print(json.dumps(res, ensure_ascii=False, indent=2))
        return
    if not res:
        print("(no results)")
        return
    for r in res:
        head = f"  › {r['heading']}" if r["heading"] else ""
        print(f"\n# {r['title']}{head}\n  {r['path']}  [score {r['score']}]")
        print("  " + r["content"][:600].replace("\n", "\n  "))


if __name__ == "__main__":
    main()
