"""vault-search MCP サーバ（stdio）。Claude が検索結果だけを受け取れる。"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from mcp.server.fastmcp import FastMCP

import config
import db
import search as S

mcp = FastMCP("vault-search")


@mcp.tool()
def search_vault(query: str, k: int = 8, folder: str = "") -> str:
    """SNSナレッジVault（knowledge/research/accounts/prompts）を横断検索し、関連箇所だけ返す。
    folder: 任意の絞り込み（knowledge|research|accounts|prompts）。"""
    res = S.search(query, k=k, folder=folder or None)
    if not res:
        return "(no results)"
    blocks = []
    for r in res:
        head = f" › {r['heading']}" if r["heading"] else ""
        blocks.append(f"## {r['title']}{head}\n`{r['path']}` (score {r['score']})\n\n{r['content']}")
    return "\n\n---\n\n".join(blocks)


@mcp.tool()
def read_doc(path: str) -> str:
    """search_vault が返した repo 相対パスのドキュメント全文を読む。"""
    target = (config.ROOT / path).resolve()
    if not str(target).startswith(str(config.ROOT)) or not target.is_file():
        return "(invalid path)"
    return target.read_text(encoding="utf-8", errors="ignore")


@mcp.tool()
def index_stats() -> str:
    """索引の状態（件数・モデル・最終更新）を返す。"""
    conn = db.connect()
    try:
        docs = conn.execute("SELECT COUNT(*) FROM documents").fetchone()[0]
        chunks = conn.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]
    except Exception:
        return "index not built yet — run: python build_index.py --full"
    model = db.get_meta(conn, "embed_model", "?")
    last = db.get_meta(conn, "last_index", "?")
    conn.close()
    return f"docs={docs} chunks={chunks} model={model} last_index={last}"


if __name__ == "__main__":
    mcp.run()
