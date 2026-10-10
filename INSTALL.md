# インストール

このバンドルは**ソース＋データ＋git履歴**入り。モデル・Python環境・検索索引は同梱せず、下記でインストール（生成）します。

## ワンコマンド

```bash
unzip sns-account-management.zip
cd sns-account-management
bash setup.sh
```

`setup.sh` が自動でやること:
1. Python 3.12 の venv 作成（`lib/index/.venv`）
2. 依存インストール（torch / sentence-transformers / sqlite-vec / mcp）
3. **モデルDL＋索引構築**（`bge-m3` ＋ `bge-reranker-v2-m3`・約6.6GB）
4. 投稿DB復元（`db/posts.jsonl` → `db/posts.db`）

## 前提
- **uv**（無ければ: `curl -LsSf https://astral.sh/uv/install.sh | sh`）
- **ネット接続**（モデル ~6.6GB のダウンロード）
- ディスク空き 約8GB

## 完了後
```bash
PY=lib/index/.venv/bin/python
$PY lib/index/search.py "伸びる投稿の冒頭"   # ナレッジ検索（RAG）
$PY lib/posts/posts.py list                  # 投稿一覧
```
Claude Code を再起動すると `vault-search` MCP が有効になります（`.mcp.json` 登録済み）。

詳細は `lib/index/README.md`（検索基盤）・`lib/posts/README.md`（投稿DB）・`CLAUDE.md`（全体）。
