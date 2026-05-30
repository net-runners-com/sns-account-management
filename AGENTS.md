# AGENTS.md — Codex 向け運用ガイド

> このプロジェクトの**コード・自動化担当（Codex）**向けの指示書。
> コンテンツ生成・運用ルールの全体方針は `CLAUDE.md` を参照。

## 役割分担
- **Codex**: コード生成・自動化スクリプト・ファイル処理 → `scripts/` / `packages/`
- **Claude Code**: コンテンツ生成・ナレッジ運用 → `prompts/` / `knowledge/` / `accounts/`

## Codex の担当範囲
- `scripts/` … 自作スクリプト（投稿自動化・データ取得・整形 等）
- `lib/index/` … ローカルRAG検索基盤（vault-search MCP）。索引構築・差分更新・DBスキーマ管理
- `.index/` … 検索DB（生成物）。`build_index.py` / `sync.sh` で生成・更新
- `.models/` … 埋め込みモデル bge-m3（プロジェクト内自己完結・gitignore・`HF_HOME`で固定）
- `packages/` … 外部パッケージ（note-research 等）の取り込み・実行
- `schedule.json` … 投稿スケジュールの読取・status更新・自動投稿の駆動元（機械可読・編集可）

## 触らないもの
- `knowledge/`（Obsidian Vault・Claude担当）
- `accounts/<brand>/`（コンテンツ・Claude担当）
- `CLAUDE.md`（Claude側の運用ルール）
