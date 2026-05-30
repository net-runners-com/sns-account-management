# SNS Account Management

複数のSNSブランドを **ブランド別 × 媒体別** に管理し、**Obsidian Vault（`knowledge/`）に貯めた運用ナレッジ**をもとに意思決定して運用するプロジェクト。
コンテンツ生成は **Claude Code**、コード・自動化は **Codex** が担当する2ツール共有環境。

- 全体ルール・判断フロー → [`CLAUDE.md`](./CLAUDE.md)
- Codex向け運用ガイド → [`AGENTS.md`](./AGENTS.md)

---

## ディレクトリ構成

```
sns-account-management/
├── CLAUDE.md              # 全体ルール・判断フロー（Claude担当）
├── AGENTS.md              # Codex向け運用ガイド（コード・自動化）
├── README.md              # このファイル
├── schedule.json          # 全ブランド・全媒体の投稿スケジュール（一元管理）
├── .mcp.json              # MCPサーバ設定
│
├── .claude/               # Claude Code 公式ディレクトリ
│   ├── settings.json
│   ├── skills/  agents/  commands/  rules/  memory/  agent_memory/
│
├── _templates/            # 各フォルダの雛形（accounts等を汚さない）
│   ├── account/           #   └ ブランド雛形（rule/profile + platforms/）
│   └── research/          #   └ リサーチ雛形（README/findings/raw）
│
├── accounts/              # ブランド別（1ブランド=1フォルダ・複数媒体を内包）
│   └── <brand>/
│       ├── rule.md        #   ブランド共通ルール
│       ├── profile.md     #   ペルソナ・ブランドボイス
│       └── platforms/<x|note|instagram|threads|youtube>/
│           ├── rule.md    #     媒体固有ルール（文字数等の制約）
│           ├── drafts/ published/ assets/ analytics/
│
├── prompts/               # コンテンツ生成プロンプト集
├── scripts/               # 自作スクリプト（Codex管轄）
├── packages/              # 外部パッケージ（note-research 等）
├── research/              # リサーチ生データ（YYYY-MM_テーマ/・raw はGit外）
│
└── knowledge/             # Obsidian Vault（運用ナレッジ蓄積）
    ├── .obsidian/         #   Obsidian設定
    ├── 00_Inbox/  10_Playbooks/  20_Cases/  30_Insights/
    ├── 99_Attachments/
    └── _templates/        #   ノート雛形（case / insight / playbook）
```

---

## 全体像（要素とツールの関わり）

```mermaid
flowchart TD
    subgraph Inputs["インプット"]
        RES["research/<br/>リサーチ生データ"]
        ANA["accounts/.../analytics/<br/>投稿の生ログ"]
    end

    subgraph Vault["knowledge/ (Obsidian Vault)"]
        CASE["20_Cases<br/>事例"]
        INS["30_Insights<br/>横断知見"]
        PLAY["10_Playbooks<br/>運用の型"]
    end

    subgraph Accounts["accounts/ (ブランド × 媒体)"]
        RULEB["rule.md<br/>ブランド共通ルール"]
        RULEP["platforms/*/rule.md<br/>媒体固有ルール"]
        DRAFT["drafts/ → published/"]
    end

    SCH["schedule.json<br/>投稿スケジュール一元管理"]
    PROMPT["prompts/<br/>生成プロンプト"]

    RES -- findings抽出 --> CASE
    ANA -- 解釈 --> CASE
    CASE -- 抽象化 --> INS
    INS -- 型化 --> PLAY

    PLAY -- 意思決定 --> DRAFT
    INS -- 意思決定 --> DRAFT
    RULEB --> DRAFT
    RULEP --> DRAFT
    PROMPT --> DRAFT

    SCH -- いつ何を出すか --> DRAFT
    DRAFT -- 公開後の数値 --> ANA

    classDef vault fill:#2d3b2d,stroke:#5a7a5a,color:#fff;
    classDef acct fill:#2d2d3b,stroke:#5a5a7a,color:#fff;
    class CASE,INS,PLAY vault;
    class RULEB,RULEP,DRAFT acct;
```

---

## ツール役割分担

```mermaid
flowchart LR
    subgraph Claude["Claude Code（コンテンツ生成）"]
        C1["prompts/ で文章生成"]
        C2["knowledge/ でナレッジ運用"]
        C3["accounts/ でコンテンツ制作"]
    end

    subgraph Codex["Codex（コード・自動化）"]
        X1["scripts/ 自作スクリプト"]
        X2["packages/ 外部ツール実行"]
        X3["schedule.json 読取→自動投稿"]
    end

    C3 -- 原稿 --> X3
    X1 -- 取得データ --> C2
    X3 -- 公開実行 --> SNS["各SNS媒体<br/>X / note / IG / Threads / YouTube"]
```

---

## 運用フロー

```mermaid
flowchart LR
    A["① 意思決定<br/>knowledge/参照"] --> B["② 制約確認<br/>ブランド+媒体 rule.md"]
    B --> C["③ 生成<br/>drafts/ → published/"]
    C --> D["④ 記録<br/>analytics/ に数値"]
    D --> E["⑤ 還元<br/>Cases→Insights昇格"]
    E -.-> A
    C -.登録/更新.-> S["schedule.json"]
```

詳細な運用ルールは [`CLAUDE.md`](./CLAUDE.md) を参照。
