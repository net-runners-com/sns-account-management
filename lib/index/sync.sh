#!/usr/bin/env bash
# Vault索引の差分更新。cron / launchd から定期実行する想定。
set -euo pipefail
cd "$(dirname "$0")"
[[ -d .venv ]] && source .venv/bin/activate
mkdir -p ../../.index
python build_index.py >> ../../.index/sync.log 2>&1
echo "$(date '+%Y-%m-%d %H:%M:%S') sync done" >> ../../.index/sync.log
