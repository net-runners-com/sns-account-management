# vault-search — ローカルRAG検索基盤

Markdown（`knowledge/` `research/` `accounts/` `prompts/`）を **SQLite + sqlite-vec** に索引し、
**ハイブリッド検索（FTS5 trigram × bge-m3 ベクトル）** を **MCPサーバ** として常駐させる。
Claude はファイルをスキャンせず `vault-search` を叩いて関連箇所だけ取得する。

- Markdown が真実の源（Obsidianと共有）。この索引（`.index/vault.db`）は **生成物**で、いつでも再構築可能（gitignore）。
- フォルダ境界を越えて横断索引するため、Obsidianの `[[リンク]]` が越えられない壁も検索側で解消される。

## 構成

| ファイル | 役割 |
|---|---|
| `config.py` | 設定（モデル・チャンク・融合重み・リランク・対象/除外） |
| `build_index.py` | 索引構築（差分／`--full`で全再構築） |
| `search.py` | ハイブリッド検索＋リランク（CLI/ライブラリ・`--no-rerank`可） |
| `rerank.py` | cross-encoder リランカー（bge-reranker-v2-m3） |
| `mcp_server.py` | `vault-search` MCPサーバ（search_vault / read_doc / index_stats） |
| `embed.py` `chunking.py` `db.py` | 埋め込み・分割・スキーマ |
| `eval/` | 精度評価（`gold.jsonl` + `run_eval.py`：Hit@k / MRR をリランクON/OFF比較） |
| `sync.sh` | 差分更新ラッパー（cron/launchd用） |

## セットアップ（本番）

```bash
cd lib/index
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# 初回フル構築（bge-m3 を初回DL：数百MB〜）
python build_index.py --full
```

## 使い方

```bash
# CLI 検索
python search.py "Threadsで伸びる冒頭の型" -k 5
python search.py "競合のサムネ傾向" --folder research --json

# 索引状態
python -c "import mcp_server" >/dev/null   # （MCPは下記参照）
```

MCPは `.mcp.json` に `vault-search` として登録済み。Claude Code 起動時に自動接続され、
`search_vault(query, k, folder)` / `read_doc(path)` / `index_stats()` が使える。

## 埋め込みモデルの切替（両対応）

```bash
# 高品質・多言語（既定）
export VAULT_EMBED_MODEL="BAAI/bge-m3"
# 高速・日本語静的
export VAULT_EMBED_MODEL="hotchpotch/static-embedding-japanese"
python build_index.py --full   # モデル変更時は必ず --full
```

## 定期更新（差分）

`sync.sh` を cron / launchd から実行（Markdownの変更分だけ再索引）。例（launchd, 毎朝7時）:

```xml
<!-- ~/Library/LaunchAgents/com.sns.vault-index.plist -->
<dict>
  <key>Label</key><string>com.sns.vault-index</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>/ABSOLUTE/PATH/lib/index/sync.sh</string></array>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>7</integer><key>Minute</key><integer>0</integer></dict>
</dict>
```

## スケール時の移行

数万チャンクまでは sqlite-vec の総当たりで十分。さらに大規模化したら
DuckDB + VSS(HNSW) や、FTSを SudachiPy 形態素＋BM25 に差し替えると精度・速度が伸びる。
