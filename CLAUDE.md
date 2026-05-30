# SNS Account Management — 全体ルール

複数のSNSアカウントを **アカウント別フォルダ** で管理し、**Obsidian Vault（`knowledge/`）に貯めた運用ナレッジ** をもとに意思決定して運用するプロジェクト。

- **全体ルール** = このファイル（`CLAUDE.md`）
- **アカウント個別ルール** = `accounts/<account-name>/rule.md`
- **運用ナレッジ** = `knowledge/`（Obsidian Vault）

---

## ディレクトリ構成

```
sns-account-management/
├── CLAUDE.md                  ← このファイル（全体ルール・判断フロー / Claude担当）
├── AGENTS.md                  ← Codex 向け運用ガイド（コード・自動化担当）
├── README.md
├── .mcp.json                  ← MCPサーバ設定（プロジェクトスコープ）
├── schedule.json              ← 未公開投稿の予定（db/posts.db から生成する派生ビュー）
├── db/                        ← ★ 投稿データ SQLite（posts.db=本文込みの真実の源 / *.jsonl=git追跡バックアップ）
│
├── .claude/                   ← Claude Code 公式ディレクトリ
│   ├── settings.json          ← 共有設定（コミットする）
│   ├── settings.local.json    ← 個人設定（gitignore）
│   ├── skills/                ← スキルを集約
│   ├── agents/                ← サブエージェント定義
│   ├── commands/              ← スラッシュコマンド
│   ├── rules/                 ← モジュール化したルール（writing-style 等を分割管理）
│   ├── memory/                ← メモリ
│   └── agent_memory/          ← エージェント別メモリ
│
├── _templates/                ← 各フォルダの雛形を集約（accounts等を汚さない）
│   ├── account/               ← 新規ブランドのコピー元
│   └── research/              ← 新規リサーチのコピー元
│
├── accounts/                  ← ブランド別（1ブランド = 1フォルダ・複数媒体を内包）
│   └── <brand-name>/          ← _templates/account/ をコピーして作る
│       ├── rule.md            ← ★ ブランド共通ルール（全媒体で守る）
│       ├── profile.md         ← ペルソナ・ターゲット・ブランドボイス
│       └── platforms/         ← 媒体別（X / note / Instagram / Threads / YouTube）
│           └── <platform>/
│               ├── rule.md      ← ★ 媒体固有ルール（文字数等の制約・トーン調整）
│               ├── drafts/      ← 書きかけ原稿
│               ├── published/   ← 公開済みアーカイブ
│               ├── assets/      ← 画像・動画・サムネ素材
│               └── analytics/   ← 生ログ（CSV/JSON）
│
├── prompts/                   ← コンテンツ生成プロンプト集・コンテンツ設計システム
├── lib/                       ← コード本体（再利用するライブラリ・システム）
│   ├── index/                 ← ローカルRAG検索基盤（vault-search MCP）
│   └── posts/                 ← 投稿データCLI（db/posts.db の操作・migrate・export）
├── scripts/                   ← 生成した単発スクリプト置き場
├── .index/                    ← 検索DB（生成物・gitignore・再構築可能）
├── .models/                   ← 埋め込みモデル bge-m3（プロジェクト内に自己完結・gitignore）
├── packages/                  ← 外部パッケージ（note-research 等の外部ツールを格納）
├── research/                  ← リサーチ系の生データ（_templates/research/ をコピーして作る）
│
└── knowledge/                 ← Obsidian Vault（運用ナレッジ蓄積）
    ├── .obsidian/             ← Obsidian設定（app/core-pluginsのみ共有）
    ├── 00_Inbox/              ← 未整理メモ
    ├── 10_Playbooks/          ← 運用の型・勝ちパターン・戦略
    ├── 20_Cases/              ← 成功/失敗事例（analyticsから昇格）
    ├── 30_Insights/           ← 横断で抽象化した知見
    └── _templates/            ← ノートテンプレート
```

番号プレフィックス（`00_` / `10_`）は Johnny.Decimal 風。フォルダの意図が読み取りやすいよう維持する。

---

## 投稿データ管理（db/posts.db）

投稿（**本文込み**）・スケジュール・分析は **`db/posts.db`（SQLite）に一元管理**する。**DBが真実の源**。
媒体ごとにファイルを散らさず、状態更新・クエリ・分析集計・自動投稿を構造化データで扱う。
操作は `lib/posts/posts.py`（CLI・stdlibのみ）。詳細は `lib/posts/README.md`。

```
db/posts.db                      ← 操作用バイナリ（gitignore・本文込み）
├── posts(id, brand, platform, status, title, theme, body, url, scheduled_at, published_at, …)
└── analytics(post_id, captured_at, impressions, engagements, saves, follows, …)

db/posts.jsonl / analytics.jsonl ← git追跡のバックアップ（差分が読める・import-jsonlで復元）
schedule.json                    ← 未公開(draft/scheduled/idea)の派生ビュー（exportで生成・自動化が読む）
accounts/<brand>/platforms/<媒体>/published/<id>.md ← 公開済みの生成md（Obsidian/RAGが拾う）
```

- **status の遷移**: `idea`（ネタ）→ `draft`（原稿あり）→ `scheduled`（日時確定）→ `published`（公開済）→（`archived`）。
- **本文はDBに入れる**（`posts.body`）。markdownはDBから生成する出力で、源ではない。
- **公開すると**：`set-status <id> published` → `export` で `published/<id>.md` を生成 → RAG索引に載る。
- **変更したら `export`**：schedule.json・公開md・jsonl を最新化（git追跡分を同期）。
- **Codexの自動投稿**：`scheduled` の行を読んで投稿し、`set-status published` + `metrics` を書き戻す。

---

## ツール役割分担（Codex × Claude Code）

| タスク | 担当 | 場所 |
|---|---|---|
| 文章生成・コピーライティング | **Claude Code** | `prompts/` のプロンプトを使用 |
| SNS投稿・記事生成 | **Claude Code** | スキル（`.claude/skills/`） |
| ナレッジ検索・引用 | **Claude Code** | `knowledge/` |
| コード生成・自動化スクリプト | Codex | `scripts/` |
| ファイル処理・バッチ | Codex | `scripts/` |
| 投稿自動化（schedule読取・実行） | Codex | `schedule.json` → `scripts/` |

- **Claude Code の主担当はコンテンツ生成**。コード・自動化は Codex に委ねる。
- **`lib/`** = 再利用するコード本体（RAG検索基盤など）。**`scripts/`** = 生成した単発スクリプト。**`packages/`** = 外部パッケージ化済みツール。
- `lib/` `scripts/` は Codex 管轄。Claude Code は明示指示がない限り改変しない。

---

## 運用フロー（毎回この順で動く）

```
① 意思決定：knowledge/ から過去ナレッジを参照して方針を決める
   （※ナレッジ参照は下記ルールに従い、明示時 or 必要時のみ）
② 制約確認：2段階でルールを読む
   - accounts/<brand>/rule.md            … ブランド共通ルール
   - accounts/<brand>/platforms/<媒体>/rule.md … 媒体固有ルール（文字数等の制約）
③ 生成・運用：両ルールに沿って制作 → platforms/<媒体>/drafts/ → published/
   （予定は schedule.json に登録し、status を draft → scheduled → published と更新）
④ 記録：投稿後の数値を platforms/<媒体>/analytics/ に生ログとして残す
⑤ 還元：analytics/ の数値を抽象化し、20_Cases/ → 30_Insights/ へ昇格
```

ルールは **ブランド共通（上位）＋ 媒体固有（詳細）** の2段重ね。媒体固有が共通を上書きするのではなく、両方を満たす。

このループでナレッジが育つ。④→⑤を回さないと知見が死蔵されるので、定期的に昇格させる。

---

## 棲み分けルール（重複を防ぐ）

| 置き場 | 役割 | 粒度 |
|---|---|---|
| `accounts/<brand>/platforms/<媒体>/analytics/` | 自媒体の生ログ（CSV/JSON、数値そのまま） | 媒体固有・raw |
| `research/` | 外部から集めた調査・リサーチの生データ | アカウント横断・raw |
| `knowledge/20_Cases/` | analyticsから昇格した「事例」 | アカウント固有・解釈付き |
| `knowledge/30_Insights/` | analytics/researchから抽象化した「知見」 | アカウント横断・再利用可 |

**昇格フロー**：`analytics/`（自データ）/ `research/`（外部データ）の生データ → 解釈を付けて `20_Cases/`（事例）→ 横断パターンを抽出して `30_Insights/`（知見）。
- `research/` と `knowledge/` を分ける理由：リサーチ生データは量が多くVaultを圧迫するため、Obsidian Vault には入れず、**得られた知見だけ** を `knowledge/30_Insights/` に昇格させる。
運用が進むと「アカウントごとの数値」と「全体横断の知見」を往復するので、節目（週次/月次・伸びた投稿が出たタイミング）で昇格を実行する。

---

## リサーチの整理ルール（research/）

リサーチは **1件 = 1フォルダ（プロジェクト単位）** で管理する。

```
research/
└── YYYY-MM_テーマ/             ← 命名規則: 日付+テーマ（時系列で並ぶ）
    ├── README.md               ← 目的・対象・結論サマリ（frontmatterにbrand/platformタグ）
    ├── raw/                    ← 生データ（json/csv/スクショ）※Git管理外
    └── findings.md             ← 抽出した学び（→ knowledge への昇格元）

※雛形は _templates/research/ にある（これをコピーして1件作る）
```

- **命名**: `YYYY-MM_テーマ`（例: `2026-05_threads-competitor`）
- **raw/ は触らない生データ**。`.gitignore` でコミット対象外（重くなるため）。`README.md` と `findings.md` だけ Git 管理。
- **対象ブランド/媒体** は `README.md` の frontmatter（`brands:` / `platforms:`）でタグ付け → 横断検索できる。
- **昇格は `findings.md` 起点**：リサーチ後に必ず `findings.md` を1枚書き、そこから `knowledge/20_Cases` `30_Insights` `10_Playbooks` へ手で昇格する。昇格したら README の `promoted: true` にする。

### リサーチの取り込みフロー

```
①リサーチ実行（packages/note-research / deep-research / 手動）
     ↓ 生出力
②research/YYYY-MM_テーマ/raw/ に着地（Git管理外）
     ↓ findings.md に学びを抽出
③knowledge/ へ昇格（解釈・抽象化したものだけ）
     ↓
④accounts/<brand>/ の運用で意思決定に使う
```

---

## 検索基盤（ローカルRAG / vault-search MCP）

ナレッジは **Obsidian（人間の編集・整理層）＋ ローカルRAG（AIの検索層）** の2層で扱う。
真実の源は Markdown。`lib/index/` がそれを **SQLite + sqlite-vec** に索引し、
**ハイブリッド検索（FTS5 trigram × bge-m3ベクトル・重み付きRRF・small-to-large）＋ cross-encoderリランク（bge-reranker-v2-m3）** を
`vault-search` MCP として提供する。agentic な使い方は skill `vault-search` を参照（分解→多クエリ→充足判定→引用付き統合）。
精度は `lib/index/eval/`（gold + run_eval.py）で計測する（直近: Hit@1≈0.96 / MRR≈0.97・リランク有）。

- **AIの検索は `vault-search` MCP を使う**：`search_vault(query, k, folder)` で関連箇所だけ取得し、
  必要なら `read_doc(path)` で全文を読む。**ファイル全スキャンの代わりに retrieval を使う**。
- 索引対象は `knowledge/` `research/` `accounts/` `prompts/` を横断（フォルダ境界を越える）。
  `raw/` `assets/` `analytics/` `_templates/` は除外。
- 索引（`.index/vault.db`）は生成物。Markdownを変えたら `lib/index/build_index.py`（差分）で更新、
  または `sync.sh` を定期実行。詳細は `lib/index/README.md`。
- 埋め込みモデル **bge-m3 は `.models/` にプロジェクト内自己完結**（`HF_HOME` を config.py で固定）。
  グローバルHFキャッシュに依存せず、オフラインでも動く。`.models/` は gitignore（消えても再DL可）。

### 索引の鮮度ルール（書いた直後のズレを防ぐ）

索引はスナップショット。**書いた直後はまだ `vault-search` に出てこない**。

- `knowledge/` `research/findings.md` 等に**ノートを書き足したら、その場で差分ビルド**：`python lib/index/build_index.py`（sha256で変更分だけなので数秒）。
- 定期運用は `sync.sh`（cron/launchd）で日次差分。
- 書いた直後にそのノートを検索したいときは、上記の差分ビルドを挟んでから `vault-search` を叩く。ビルド前は索引に無い前提で動く（古い結果を新しいと誤認しない）。

## ナレッジ参照のルール（コンテキスト事故防止）

- `knowledge/` は育つとVault全体が大きくなる。**全体を無条件にスキャンしない**。まず `vault-search` で引く。
- ナレッジ検索は **ユーザーから明示的に指示されたとき**、または **運用フロー①の意思決定で必要なとき** に限定する。
- `vault-search` が未構築/未接続のときのみ、関連フォルダ（`10_Playbooks/` `20_Cases/` `30_Insights/`）を狙って読む。`00_Inbox/` は未整理なので明示指示がない限り読まない。

---

## 新規ブランドの追加手順

1. `_templates/account/` を `accounts/<brand-name>/` にコピー
2. ブランド共通の `rule.md` と `profile.md` を記入
3. 使う媒体だけ `platforms/<媒体>/` を残す（使わない媒体フォルダは削除）
4. 各媒体の `platforms/<媒体>/rule.md`（制約・トーン）を記入
5. 投稿予定はルートの `schedule.json` に追記する（媒体フォルダには持たせない）

## 新規リサーチの追加手順

1. `_templates/research/` を `research/YYYY-MM_テーマ/` にコピー
2. `README.md`（目的・対象・frontmatterのタグ）を記入
3. 生データは `raw/` に置く（Git管理外）／学びは `findings.md` に書く

---

## .obsidian のコミット方針

- **共有する**：`app.json` / `core-plugins.json`（プロジェクト共通設定）
- **gitignoreする**：`workspace.json` / `graph.json` / `workspace-mobile.json` など個人環境依存ファイル（差分が頻発するため）
- 詳細は `.gitignore` を参照。
