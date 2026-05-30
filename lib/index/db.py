"""SQLite + sqlite-vec のスキーマと接続。"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import sqlite3
import sqlite_vec
import config


def connect():
    config.INDEX_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(config.DB_PATH))
    conn.enable_load_extension(True)
    sqlite_vec.load(conn)
    conn.enable_load_extension(False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


BASE_SCHEMA = """
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS documents(
  doc_id INTEGER PRIMARY KEY,
  path TEXT UNIQUE NOT NULL,
  folder TEXT, title TEXT,
  sha256 TEXT NOT NULL, mtime REAL, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS chunks(
  chunk_id INTEGER PRIMARY KEY,
  doc_id INTEGER NOT NULL,
  ord INTEGER, heading TEXT, content TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chunks_doc ON chunks(doc_id, ord);
-- 日本語キーワード検索：trigram トークナイザ（辞書不要で語境界問題を回避）
CREATE VIRTUAL TABLE IF NOT EXISTS fts_chunks USING fts5(
  chunk_id UNINDEXED, content, tokenize='trigram'
);
"""


def init(conn):
    conn.executescript(BASE_SCHEMA)
    conn.commit()


def ensure_vec(conn, dim: int):
    """埋め込み次元が確定してからベクトル表を作る（モデルにより次元が違うため）。"""
    conn.execute(
        f"CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0("
        f"chunk_id integer primary key, embedding float[{dim}] distance_metric=cosine)"
    )
    conn.commit()


def get_meta(conn, key, default=None):
    r = conn.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
    return r["value"] if r else default


def set_meta(conn, key, value):
    conn.execute(
        "INSERT INTO meta(key,value) VALUES(?,?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (key, str(value)),
    )
    conn.commit()


def drop_all(conn):
    for t in ("fts_chunks", "vec_chunks", "chunks", "documents", "meta"):
        conn.execute(f"DROP TABLE IF EXISTS {t}")
    conn.commit()
