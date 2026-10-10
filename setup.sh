#!/usr/bin/env bash
# sns-account-management ワンコマンド・インストーラ
#   - Python環境(venv)作成 → 依存インストール → モデルDL+索引構築 → 投稿DB復元
# 使い方:  bash setup.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
echo "== sns-account-management セットアップ =="
echo "   (bge-m3 + reranker のDLで ~6.6GB / ネット接続が必要です)"
echo

# 0) 前提チェック
if ! command -v uv >/dev/null 2>&1; then
  echo "❌ 'uv' が必要です。インストール:"
  echo "   curl -LsSf https://astral.sh/uv/install.sh | sh"
  exit 1
fi

# 1) venv (Python 3.12)
echo "[1/4] venv 作成 (Python 3.12)…"
cd "$ROOT/lib/index"
uv venv .venv --python 3.12
PY="$ROOT/lib/index/.venv/bin/python"

# 2) 依存（torch等）
echo "[2/4] 依存インストール…"
uv pip install --python .venv/bin/python -r requirements.txt

# 3) モデルDL + 索引構築（埋め込み bge-m3 ＋ リランカー）
echo "[3/4] モデルDL + 索引構築（数分〜・~6.6GB）…"
"$PY" build_index.py --full
"$PY" -c "import sys; sys.path.insert(0,'.'); from rerank import Reranker; Reranker(); print('reranker ready')"

# 4) 投稿DB復元（jsonl → db/posts.db）
echo "[4/4] 投稿DB復元…"
cd "$ROOT"
"$PY" lib/posts/posts.py import-jsonl

echo
echo "✅ セットアップ完了"
echo "   検索 : $PY lib/index/search.py \"伸びる投稿の冒頭\""
echo "   投稿 : $PY lib/posts/posts.py list"
echo "   MCP  : Claude Code を再起動すると vault-search が有効になります"
