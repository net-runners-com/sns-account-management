"""コーパスを走査して索引を構築（差分更新／--full で全再構築）。"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import hashlib
import datetime
import argparse

import config
import db
from chunking import chunk_markdown
from embed import Embedder
from sqlite_vec import serialize_float32


def iter_files():
    for d in config.INCLUDE_DIRS:
        base = config.ROOT / d
        if not base.exists():
            continue
        for p in sorted(base.rglob("*")):
            if not p.is_file() or p.suffix.lower() not in config.INCLUDE_EXT:
                continue
            rel = p.relative_to(config.ROOT)
            if any(part in config.EXCLUDE_PARTS for part in rel.parts):
                continue
            yield p, rel


def _sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def _title(text, rel):
    for ln in text.splitlines():
        if ln.startswith("# "):
            return ln[2:].strip()
    return rel.stem


def _delete_doc(conn, doc_id):
    for (cid,) in conn.execute("SELECT chunk_id FROM chunks WHERE doc_id=?", (doc_id,)).fetchall():
        conn.execute("DELETE FROM fts_chunks WHERE chunk_id=?", (cid,))
        conn.execute("DELETE FROM vec_chunks WHERE chunk_id=?", (cid,))
    conn.execute("DELETE FROM chunks WHERE doc_id=?", (doc_id,))
    conn.execute("DELETE FROM documents WHERE doc_id=?", (doc_id,))


def main():
    ap = argparse.ArgumentParser(description="build/update the vault search index")
    ap.add_argument("--full", action="store_true", help="索引を破棄してゼロから再構築")
    args = ap.parse_args()

    conn = db.connect()
    if args.full:
        db.drop_all(conn)
    db.init(conn)

    prev_model = db.get_meta(conn, "embed_model")
    if prev_model and prev_model != config.EMBED_MODEL and not args.full:
        sys.exit(f"埋め込みモデル変更を検出 ({prev_model} -> {config.EMBED_MODEL})。"
                 f"--full で再構築してください。")

    embedder = None
    cur = conn.cursor()
    seen = set()
    n_idx = 0

    for p, rel in iter_files():
        relstr = rel.as_posix()
        seen.add(relstr)
        digest = _sha(p)
        row = cur.execute("SELECT doc_id, sha256 FROM documents WHERE path=?", (relstr,)).fetchone()
        if row and row["sha256"] == digest and not args.full:
            continue
        if row:
            _delete_doc(conn, row["doc_id"])

        text = p.read_text(encoding="utf-8", errors="ignore")
        _fm, chunks = chunk_markdown(text, config.SMALL_CHUNK, config.SMALL_OVERLAP)
        cur.execute(
            "INSERT INTO documents(path,folder,title,sha256,mtime,updated_at) VALUES(?,?,?,?,?,?)",
            (relstr, rel.parts[0], _title(text, rel), digest, p.stat().st_mtime,
             datetime.datetime.now(datetime.timezone.utc).isoformat()),
        )
        doc_id = cur.lastrowid
        if not chunks:
            conn.commit()
            continue

        if embedder is None:
            embedder = Embedder()
            db.ensure_vec(conn, embedder.dim)
            db.set_meta(conn, "embed_model", config.EMBED_MODEL)
            db.set_meta(conn, "embed_dim", embedder.dim)

        texts = [(h + "\n" + c).strip() if h else c for h, c in chunks]
        vecs = embedder.embed(texts)
        for i, ((h, c), v) in enumerate(zip(chunks, vecs)):
            cur.execute("INSERT INTO chunks(doc_id,ord,heading,content) VALUES(?,?,?,?)", (doc_id, i, h, c))
            cid = cur.lastrowid
            cur.execute("INSERT INTO fts_chunks(chunk_id,content) VALUES(?,?)",
                        (cid, (h + "\n" + c).strip() if h else c))
            cur.execute("INSERT INTO vec_chunks(chunk_id,embedding) VALUES(?,?)",
                        (cid, serialize_float32(v.tolist())))
        conn.commit()
        n_idx += 1
        print(f"  indexed {relstr} ({len(chunks)} chunks)")

    # 削除されたファイルを索引から除去
    for row in cur.execute("SELECT doc_id, path FROM documents").fetchall():
        if row["path"] not in seen:
            _delete_doc(conn, row["doc_id"])
            print(f"  removed {row['path']}")
    conn.commit()
    db.set_meta(conn, "last_index", datetime.datetime.now(datetime.timezone.utc).isoformat())

    docs = cur.execute("SELECT COUNT(*) FROM documents").fetchone()[0]
    total = cur.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]
    conn.close()
    print(f"done. {n_idx} docs (re)indexed; index now {docs} docs / {total} chunks.")


if __name__ == "__main__":
    main()
