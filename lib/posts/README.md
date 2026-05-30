# posts — 投稿データの SQLite ストア

投稿（本文込み）・スケジュール・分析を **`db/posts.db`** に一元管理する。**DBが真実の源**。
知識（`knowledge/`）は markdown のまま（Obsidian＋RAG）。投稿は構造化データなのでSQLiteが向く。

## データ
- `db/posts.db`（操作用・gitignore）… `posts`（本文込み）＋ `analytics`
- `db/posts.jsonl` / `db/analytics.jsonl`（git追跡）… バックアップ。差分が読める
- 公開済み → `accounts/<brand>/platforms/<platform>/published/<id>.md`（exportで生成・Obsidian/RAGが拾う）
- 未公開 → `schedule.json`（exportで生成・自動化が読む派生ビュー）

## ステータス遷移
`idea → draft → scheduled → published`（+ `archived`）

## CLI（stdlibのみ・venv不要）

```bash
PY=python3   # もしくは lib/index/.venv/bin/python

# 追加
$PY lib/posts/posts.py add --brand ai-hacks --platform x --status draft \
    --title "タイトル" --body "本文" --scheduled-at 2026-06-05

# 一覧 / 詳細
$PY lib/posts/posts.py list --brand ai-hacks --status draft
$PY lib/posts/posts.py show 2026-06-05-ai-hacks-x-001

# 状態更新 / 分析記録
$PY lib/posts/posts.py set-status <id> published --url https://... --at 2026-06-05
$PY lib/posts/posts.py metrics <id> --impressions 12000 --saves 340 --follows 45

# 取り込み / 書き出し / 復元
$PY lib/posts/posts.py migrate        # 既存 schedule.json + md を DB へ
$PY lib/posts/posts.py export         # DB → 公開md + schedule.json + jsonl
$PY lib/posts/posts.py import-jsonl   # jsonl から DB を復元（クローン後など）
```

## 運用の流れ
1. Claude が本文生成 → `add`（status=draft）
2. 日程決定 → `set-status <id> scheduled`（or Codex が schedule.json から自動投稿）
3. 公開 → `set-status <id> published` → `export`（公開md生成→RAGに載る）
4. 数値取得 → `metrics`（Codexが定期収集）
5. 変更後は `export` して jsonl と公開md を更新（git追跡分を最新化）
