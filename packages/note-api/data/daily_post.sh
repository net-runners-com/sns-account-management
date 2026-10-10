#!/bin/bash
# note.com 毎日自動投稿スクリプト
# crontab: 0 10 * * * /path/to/daily_post.sh >> /path/to/logs/cron.log 2>&1

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$SCRIPT_DIR/logs"
PYTHON="$HOME/.browser-use-env/bin/python3"

mkdir -p "$LOG_DIR"

echo "=========================================="
echo "$(date '+%Y-%m-%d %H:%M:%S') 自動投稿開始"
echo "=========================================="

# Step 1: 記事生成
echo "[1/2] 記事生成中..."
"$PYTHON" "$SCRIPT_DIR/scripts/generate_article.py"

TITLE=$(cat "$SCRIPT_DIR/output/title.txt")
echo "  タイトル: $TITLE"

# Step 2: note投稿
echo "[2/2] note.com に投稿中..."
"$PYTHON" "$SCRIPT_DIR/scripts/post_to_note.py" \
  "$TITLE" \
  "$SCRIPT_DIR/output/article.md"

echo "$(date '+%Y-%m-%d %H:%M:%S') ✅ 投稿完了: $TITLE"
