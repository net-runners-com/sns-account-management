#!/usr/bin/env python3
"""
Claude Code CLIを使って自己啓発系のnote記事を自動生成するスクリプト。
トピックリストからランダムに選んで記事を生成し output/ に保存する。
"""

import sys
import random
import subprocess
from pathlib import Path
from datetime import datetime

SCRIPT_DIR = Path(__file__).parent
BASE_DIR = SCRIPT_DIR.parent
OUTPUT_DIR = BASE_DIR / "output"
STYLES_DIR = BASE_DIR / "references" / "styles"
DEFAULT_STYLE = "ren"


def list_styles() -> list[str]:
    """利用可能なスタイル一覧を返す"""
    return [f.stem for f in STYLES_DIR.glob("*.md") if not f.stem.endswith("_topics")]


def get_style_files(style_name: str) -> tuple[Path, Path, Path]:
    """スタイル名からファイルパスを返す (style, topics, used_topics)"""
    style_file = STYLES_DIR / f"{style_name}.md"
    topics_file = STYLES_DIR / f"{style_name}_topics.md"
    used_file = STYLES_DIR / f"{style_name}_used.txt"
    if not style_file.exists():
        print(f"❌ スタイル '{style_name}' が見つかりません")
        print(f"  利用可能: {', '.join(list_styles())}")
        sys.exit(1)
    return style_file, topics_file, used_file


def get_chrome_profile(style_file: Path) -> str:
    """スタイルファイルからchrome_profileを読み取る"""
    for line in style_file.read_text(encoding="utf-8").splitlines():
        if line.startswith("chrome_profile:"):
            return line.split(":", 1)[1].strip()
    return "Profile 1"


def load_topics(topics_file: Path) -> list[str]:
    """topics.mdからトピック一覧を読み込む"""
    if not topics_file.exists():
        return []
    topics = []
    for line in topics_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line.startswith("- "):
            topics.append(line[2:].strip())
    return topics


def pick_topic(topics: list[str], used_file: Path) -> str:
    """未使用のトピックをランダムに選ぶ（全部使ったらリセット）"""
    used = set()
    if used_file.exists():
        used = set(used_file.read_text(encoding="utf-8").splitlines())

    unused = [t for t in topics if t not in used]
    if not unused:
        print("  ℹ トピックを全消費したのでリセットします")
        used_file.write_text("", encoding="utf-8")
        unused = topics

    topic = random.choice(unused)

    with open(used_file, "a", encoding="utf-8") as f:
        f.write(topic + "\n")

    return topic


def generate_article(topic: str, style_file: Path) -> tuple[str, str]:
    """Claude Code CLIで記事を生成。(title, body_markdown) を返す"""
    style_guide = style_file.read_text(encoding="utf-8")

    prompt = f"""以下のスタイルガイドに従って、日本語のnote記事を書いてください。

=== スタイルガイド ===
{style_guide}

=== トピック ===
{topic}

=== 出力形式 ===
必ず以下の形式で出力してください：

TITLE: （ここにタイトルのみ）
---
（ここに本文のMarkdown）

注意：
- TITLE: の行はタイトルだけ（30文字以内）
- 本文はMarkdownで1500〜2500字
- 読者が「やってみよう」と思える締めにする
"""

    print("  🤖 Claude Code CLIで記事生成中...")
    result = subprocess.run(
        ["claude", "-p", prompt],
        capture_output=True,
        text=True,
        encoding="utf-8",
    )

    if result.returncode != 0:
        print(f"❌ claude CLI エラー: {result.stderr}")
        sys.exit(1)

    content = result.stdout

    # TITLE: と本文を分割
    lines = content.strip().split("\n")
    title = ""
    body_lines = []
    in_body = False

    for line in lines:
        if line.startswith("TITLE:"):
            title = line.replace("TITLE:", "").strip()
        elif line.strip() == "---" and title and not in_body:
            in_body = True
        elif in_body:
            body_lines.append(line)

    if not title or not body_lines:
        # フォールバック: 最初の行をタイトルとして扱う
        title = lines[0].lstrip("#").strip()[:30]
        body_lines = lines[1:]

    body = "\n".join(body_lines).strip()
    return title, body


def main():
    # Usage: generate_article.py [--style ren] [トピック]
    style_name = DEFAULT_STYLE
    topic_arg = None

    args = sys.argv[1:]
    i = 0
    positional = []
    while i < len(args):
        if args[i] == "--style" and i + 1 < len(args):
            style_name = args[i + 1]
            i += 2
        elif args[i] == "--list":
            print("利用可能なスタイル:")
            for s in list_styles():
                print(f"  - {s}")
            sys.exit(0)
        else:
            positional.append(args[i])
            i += 1

    if positional:
        topic_arg = " ".join(positional)

    # スタイルファイル取得
    style_file, topics_file, used_file = get_style_files(style_name)
    print(f"  スタイル: {style_name}")

    # 出力先をスタイル別にする
    timestamp = datetime.now().strftime("%Y-%m-%d-%H%M")
    out_dir = OUTPUT_DIR / style_name / timestamp
    out_dir.mkdir(parents=True, exist_ok=True)

    # トピック選択
    if topic_arg:
        topic = topic_arg
        print(f"  指定トピック: {topic}")
    else:
        topics = load_topics(topics_file)
        if not topics:
            print(f"❌ {topics_file.name} にトピックが見つかりません")
            sys.exit(1)
        topic = pick_topic(topics, used_file)
        print(f"  選択トピック: {topic}")

    # 記事生成
    title, body = generate_article(topic, style_file)

    # 保存
    (out_dir / "title.txt").write_text(title, encoding="utf-8")
    (out_dir / "article.md").write_text(body, encoding="utf-8")

    # ログ
    log_dir = BASE_DIR / "logs"
    log_dir.mkdir(exist_ok=True)
    with open(log_dir / "posts.log", "a", encoding="utf-8") as f:
        f.write(f"{datetime.now().strftime('%Y-%m-%d %H:%M')} | {style_name} | {title} | {topic}\n")

    chrome_profile = get_chrome_profile(style_file)

    print(f"  ✅ 記事生成完了")
    print(f"  タイトル: {title}")
    print(f"  文字数: {len(body)}字")
    print(f"  出力: {out_dir}/article.md")
    print(f"  Chrome Profile: {chrome_profile}")
    print(f"  CHROME_PROFILE={chrome_profile}")  # パイプ用


if __name__ == "__main__":
    main()
