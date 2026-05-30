"""投稿データ CLI（SQLiteが真実の源）。
  add / list / show / set-status / metrics / migrate / export / import-jsonl
公開済みは markdown に、未公開は schedule.json に、全件は db/posts.jsonl にエクスポートする。
"""
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import argparse
import json
import datetime
from pathlib import Path

import db
from db import ROOT, DB_DIR


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def today():
    return now()[:10]


def _seq(conn, brand, platform, date):
    pre = f"{date}-{brand}-{platform}-"
    n = conn.execute("SELECT COUNT(*) FROM posts WHERE id LIKE ?", (pre + "%",)).fetchone()[0]
    return f"{pre}{n + 1:03d}"


def _published_path(brand, platform, post_id):
    return ROOT / "accounts" / brand / "platforms" / platform / "published" / f"{post_id}.md"


# ---------- 基本操作 ----------
def cmd_add(conn, a):
    body = a.body or (Path(a.body_file).read_text(encoding="utf-8") if a.body_file else "")
    date = (a.scheduled_at or today())[:10]
    pid = a.id or _seq(conn, a.brand, a.platform, date)
    conn.execute(
        "INSERT INTO posts(id,brand,platform,status,title,theme,body,scheduled_at,notes,created_at,updated_at)"
        " VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        (pid, a.brand, a.platform, a.status, a.title, a.theme, body, a.scheduled_at, a.notes, now(), now()),
    )
    conn.commit()
    print(f"added {pid} ({a.status})")


def cmd_list(conn, a):
    q = "SELECT id,brand,platform,status,title,scheduled_at FROM posts WHERE 1=1"
    args = []
    for f in ("brand", "platform", "status"):
        v = getattr(a, f)
        if v:
            q += f" AND {f}=?"
            args.append(v)
    q += " ORDER BY COALESCE(scheduled_at, created_at)"
    rows = conn.execute(q, args).fetchall()
    for r in rows:
        sched = r["scheduled_at"] or "-"
        print(f"{r['status']:<10} {r['brand']}/{r['platform']:<9} {sched[:10]:<11} {r['title'] or ''}  [{r['id']}]")
    print(f"\n{len(rows)} posts")


def cmd_show(conn, a):
    r = conn.execute("SELECT * FROM posts WHERE id=?", (a.id,)).fetchone()
    if not r:
        sys.exit("not found")
    for k in r.keys():
        if k != "body":
            print(f"{k}: {r[k]}")
    print("\n--- body ---\n" + (r["body"] or ""))
    met = conn.execute("SELECT * FROM analytics WHERE post_id=? ORDER BY captured_at", (a.id,)).fetchall()
    if met:
        print("\n--- analytics ---")
        for m in met:
            print({k: m[k] for k in m.keys() if k not in ("id", "post_id") and m[k] is not None})


def cmd_set_status(conn, a):
    fields = {"status": a.status, "updated_at": now()}
    if a.url:
        fields["url"] = a.url
    if a.status == "published":
        fields["published_at"] = a.at or now()
    sets = ", ".join(f"{k}=?" for k in fields)
    conn.execute(f"UPDATE posts SET {sets} WHERE id=?", (*fields.values(), a.id))
    conn.commit()
    print(f"{a.id} -> {a.status}")


def cmd_metrics(conn, a):
    cols = ["impressions", "engagements", "saves", "shares", "likes", "comments", "follows"]
    vals = {c: getattr(a, c) for c in cols if getattr(a, c) is not None}
    conn.execute(
        "INSERT INTO analytics(post_id,captured_at," + ",".join(vals) + ") VALUES(?,?" + ",?" * len(vals) + ")",
        (a.id, a.at or now(), *vals.values()),
    )
    conn.commit()
    print(f"metrics recorded for {a.id}: {vals}")


# ---------- 取り込み / 書き出し ----------
def cmd_migrate(conn, a):
    """既存の schedule.json と accounts/**/{drafts,published}/*.md を DB に取り込む。"""
    used_paths = set()
    sched_path = ROOT / "schedule.json"
    n = 0
    if sched_path.exists():
        sched = json.loads(sched_path.read_text(encoding="utf-8"))
        for p in sched.get("posts", []):
            body = ""
            dp = p.get("draft")
            if dp and (ROOT / dp).exists():
                body = (ROOT / dp).read_text(encoding="utf-8")
                used_paths.add(dp)
            conn.execute(
                "INSERT OR IGNORE INTO posts(id,brand,platform,status,title,theme,body,scheduled_at,notes,created_at,updated_at)"
                " VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                (p["id"], p["brand"], p["platform"], p.get("status", "draft"), p.get("title"),
                 p.get("theme"), body, p.get("date"), p.get("notes"), now(), now()),
            )
            n += 1
        for i, idea in enumerate(sched.get("ideas", []), 1):
            if not idea.get("brand"):
                continue
            pid = f"idea-{idea['brand']}-{idea.get('platform') or 'any'}-{i:03d}"
            conn.execute(
                "INSERT OR IGNORE INTO posts(id,brand,platform,status,theme,notes,created_at,updated_at)"
                " VALUES(?,?,?,?,?,?,?,?)",
                (pid, idea["brand"], idea.get("platform") or "any", "idea", idea.get("theme"),
                 idea.get("notes"), now(), now()),
            )
            n += 1
    # schedule に出てこない md も拾う
    accounts = ROOT / "accounts"
    if accounts.exists():
        for md in sorted(accounts.rglob("platforms/*/drafts/*.md")) + sorted(accounts.rglob("platforms/*/published/*.md")):
            rel = md.relative_to(ROOT).as_posix()
            if rel in used_paths:
                continue
            parts = md.relative_to(accounts).parts  # <brand>/platforms/<platform>/<sub>/<file>
            brand, platform, sub = parts[0], parts[2], parts[3]
            status = "published" if sub == "published" else "draft"
            pid = _seq(conn, brand, platform, today())
            conn.execute(
                "INSERT OR IGNORE INTO posts(id,brand,platform,status,title,body,created_at,updated_at)"
                " VALUES(?,?,?,?,?,?,?,?)",
                (pid, brand, platform, status, md.stem, md.read_text(encoding="utf-8"), now(), now()),
            )
            n += 1
    conn.commit()
    print(f"migrated {n} posts into {db.DB_PATH}")


def cmd_export(conn, a):
    """DB → 公開md / schedule.json / db/posts.jsonl を再生成。"""
    # 1) 公開済みを markdown へ（Obsidian/RAG用）
    pub = conn.execute("SELECT * FROM posts WHERE status='published'").fetchall()
    for r in pub:
        path = _published_path(r["brand"], r["platform"], r["id"])
        path.parent.mkdir(parents=True, exist_ok=True)
        fm = (f"---\nid: {r['id']}\nbrand: {r['brand']}\nplatform: {r['platform']}\n"
              f"status: published\npublished_at: {r['published_at'] or ''}\nurl: {r['url'] or ''}\n---\n\n")
        title = r["title"] or r["id"]
        body = r["body"] or ""
        head = "" if body.lstrip().startswith("#") else f"# {title}\n\n"
        path.write_text(fm + head + body + ("\n" if not body.endswith("\n") else ""), encoding="utf-8")
    # 2) 未公開を schedule.json へ
    posts, ideas = [], []
    for r in conn.execute("SELECT * FROM posts WHERE status IN ('draft','scheduled')"
                          " ORDER BY COALESCE(scheduled_at, created_at)").fetchall():
        posts.append({"id": r["id"], "brand": r["brand"], "platform": r["platform"],
                      "date": (r["scheduled_at"] or "")[:10], "theme": r["theme"], "title": r["title"],
                      "status": r["status"], "notes": r["notes"] or ""})
    for r in conn.execute("SELECT * FROM posts WHERE status='idea'").fetchall():
        ideas.append({"brand": r["brand"], "platform": None if r["platform"] == "any" else r["platform"],
                      "theme": r["theme"], "notes": r["notes"] or ""})
    (ROOT / "schedule.json").write_text(
        json.dumps({"version": 1, "updated": today(), "source": "db/posts.db (generated)",
                    "posts": posts, "ideas": ideas}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    # 3) 全件を JSONL バックアップ（git追跡・差分が読める）
    DB_DIR.mkdir(parents=True, exist_ok=True)
    with open(DB_DIR / "posts.jsonl", "w", encoding="utf-8") as f:
        for r in conn.execute("SELECT * FROM posts ORDER BY id").fetchall():
            f.write(json.dumps({k: r[k] for k in r.keys()}, ensure_ascii=False) + "\n")
    with open(DB_DIR / "analytics.jsonl", "w", encoding="utf-8") as f:
        for r in conn.execute("SELECT * FROM analytics ORDER BY id").fetchall():
            f.write(json.dumps({k: r[k] for k in r.keys()}, ensure_ascii=False) + "\n")
    print(f"exported: {len(pub)} published md / {len(posts)} scheduled / schedule.json / posts.jsonl")


def cmd_import_jsonl(conn, a):
    """db/posts.jsonl から DB を再構築（バックアップから復元）。"""
    db.init(conn)
    pj = DB_DIR / "posts.jsonl"
    n = 0
    if pj.exists():
        for line in pj.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            r = json.loads(line)
            cols = ",".join(r.keys())
            conn.execute(f"INSERT OR REPLACE INTO posts({cols}) VALUES({','.join('?' * len(r))})", tuple(r.values()))
            n += 1
    aj = DB_DIR / "analytics.jsonl"
    if aj.exists():
        for line in aj.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            r = json.loads(line)
            cols = ",".join(r.keys())
            conn.execute(f"INSERT OR REPLACE INTO analytics({cols}) VALUES({','.join('?' * len(r))})", tuple(r.values()))
    conn.commit()
    print(f"imported {n} posts from jsonl")


def main():
    ap = argparse.ArgumentParser(description="投稿データ CLI（SQLite）")
    sub = ap.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("add"); s.set_defaults(fn=cmd_add)
    s.add_argument("--brand", required=True); s.add_argument("--platform", required=True, choices=db.PLATFORMS)
    s.add_argument("--status", default="draft", choices=db.STATUSES)
    s.add_argument("--title"); s.add_argument("--theme"); s.add_argument("--body"); s.add_argument("--body-file")
    s.add_argument("--scheduled-at", dest="scheduled_at"); s.add_argument("--notes"); s.add_argument("--id")

    s = sub.add_parser("list"); s.set_defaults(fn=cmd_list)
    s.add_argument("--brand"); s.add_argument("--platform"); s.add_argument("--status")

    s = sub.add_parser("show"); s.set_defaults(fn=cmd_show); s.add_argument("id")

    s = sub.add_parser("set-status"); s.set_defaults(fn=cmd_set_status)
    s.add_argument("id"); s.add_argument("status", choices=db.STATUSES)
    s.add_argument("--url"); s.add_argument("--at")

    s = sub.add_parser("metrics"); s.set_defaults(fn=cmd_metrics)
    s.add_argument("id")
    for c in ["impressions", "engagements", "saves", "shares", "likes", "comments", "follows"]:
        s.add_argument(f"--{c}", type=int)
    s.add_argument("--at")

    sub.add_parser("migrate").set_defaults(fn=cmd_migrate)
    sub.add_parser("export").set_defaults(fn=cmd_export)
    sub.add_parser("import-jsonl").set_defaults(fn=cmd_import_jsonl)

    a = ap.parse_args()
    conn = db.connect()
    db.init(conn)
    a.fn(conn, a)
    conn.close()


if __name__ == "__main__":
    main()
