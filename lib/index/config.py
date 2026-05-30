"""vault-search 設定。環境変数で上書き可能。"""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]          # リポジトリルート
INDEX_DIR = ROOT / ".index"
DB_PATH = Path(os.environ.get("VAULT_DB_PATH", str(INDEX_DIR / "vault.db")))

# モデルをプロジェクト内に自己完結させる（グローバルHFキャッシュを使わない）。
# config を import した時点で HF_HOME を固定 → 以降の sentence-transformers/transformers が .models を使う。
MODELS_DIR = Path(os.environ.get("VAULT_MODELS_DIR", str(ROOT / ".models")))
os.environ.setdefault("HF_HOME", str(MODELS_DIR))

# 埋め込みモデル（sentence-transformers でロード）
#   高品質・多言語   : BAAI/bge-m3                          (1024d)
#   高速・日本語静的 : hotchpotch/static-embedding-japanese  (1024d)
# モデルを変えたら build_index.py --full で再構築すること。
EMBED_MODEL = os.environ.get("VAULT_EMBED_MODEL", "BAAI/bge-m3")

# Small-to-Large チャンク戦略：小さく索引し、検索後に前後を含めて広く返す
SMALL_CHUNK = int(os.environ.get("VAULT_SMALL_CHUNK", "320"))      # 索引チャンクの文字数
SMALL_OVERLAP = int(os.environ.get("VAULT_SMALL_OVERLAP", "48"))
CONTEXT_WINDOW = int(os.environ.get("VAULT_CONTEXT_WINDOW", "1"))   # 返却時に前後何チャンク含めるか

# ハイブリッド融合（重み付き RRF）
RRF_K = 60
W_VEC = float(os.environ.get("VAULT_W_VEC", "1.0"))   # ベクトル検索の重み
W_FTS = float(os.environ.get("VAULT_W_FTS", "1.0"))   # 全文検索の重み
CANDIDATES = int(os.environ.get("VAULT_CANDIDATES", "30"))  # 各リトリーバの候補数

# リランカー（cross-encoder）：ハイブリッド候補を本当の関連度で並べ直す
RERANK_ENABLED = os.environ.get("VAULT_RERANK", "1") != "0"
RERANK_MODEL = os.environ.get("VAULT_RERANK_MODEL", "BAAI/bge-reranker-v2-m3")
RERANK_CANDIDATES = int(os.environ.get("VAULT_RERANK_CANDIDATES", "20"))  # リランク対象にする上位候補数

# 索引対象コーパス（フォルダ境界を越えて横断＝Obsidianの孤島問題を回避）
INCLUDE_DIRS = ["knowledge", "research", "accounts", "prompts"]
INCLUDE_EXT = {".md"}
# パスにこれらの要素を含むものは除外（生データ・素材・テンプレ・コード）
EXCLUDE_PARTS = {
    ".git", ".obsidian", ".index", "raw", "assets", "analytics",
    "_templates", "node_modules", ".venv", "__pycache__",
}
