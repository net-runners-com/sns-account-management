"""投稿データの SQLite ストア（posts + analytics）。本文もここが真実の源。stdlibのみ。"""
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DB_DIR = ROOT / "db"
DB_PATH = Path(os.environ.get("POSTS_DB_PATH", str(DB_DIR / "posts.db")))

STATUSES = ("idea", "draft", "scheduled", "published", "archived")
PLATFORMS = ("x", "note", "instagram", "threads", "youtube")

SCHEMA = """
CREATE TABLE IF NOT EXISTS posts(
  id TEXT PRIMARY KEY,
  brand TEXT NOT NULL,
  platform TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'idea',   -- idea|draft|scheduled|published|archived
  title TEXT,
  theme TEXT,
  body TEXT,                              -- 本文（真実の源）
  url TEXT,
  scheduled_at TEXT,
  published_at TEXT,
  notes TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(brand, platform, status);

CREATE TABLE IF NOT EXISTS analytics(
  id INTEGER PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  captured_at TEXT,
  impressions INTEGER,
  engagements INTEGER,
  saves INTEGER,
  shares INTEGER,
  likes INTEGER,
  comments INTEGER,
  follows INTEGER,
  extra TEXT                              -- 媒体固有メトリクスの JSON
);
CREATE INDEX IF NOT EXISTS idx_analytics_post ON analytics(post_id, captured_at);
"""


def connect():
    DB_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init(conn):
    conn.executescript(SCHEMA)
    conn.commit()
