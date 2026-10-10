#!/usr/bin/env python3
"""Gemini APIを使って記事用画像を生成するスクリプト"""

import urllib.request
import json
import base64
import sys
import os
from pathlib import Path

# .env 読み込み
env_path = Path(__file__).resolve().parents[4] / ".env"
if env_path.exists():
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())

API_KEY = os.environ.get("GEMINI_API_KEY", "")
MODEL = "gemini-2.0-flash-exp"
NOTE_WIDTH = 1280
NOTE_HEIGHT = 670


def resize_to_note_size(img_data: bytes) -> bytes:
    """PIL で 1280x670px にリサイズ"""
    try:
        from PIL import Image
        import io
        img = Image.open(io.BytesIO(img_data))
        img = img.resize((NOTE_WIDTH, NOTE_HEIGHT), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()
    except ImportError:
        print("⚠ PIL not found, skipping resize. Install: pip install Pillow")
        return img_data


def generate_image(prompt: str, output_path: str) -> bool:
    """Gemini APIで画像生成してファイル保存"""
    if not API_KEY:
        print("❌ GEMINI_API_KEY が未設定です")
        return False

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent?key={API_KEY}"
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseModalities": ["IMAGE", "TEXT"],
        }
    }

    print(f"🎨 画像生成中: {output_path}")
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST"
    )

    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            result = json.loads(resp.read())

        for part in result["candidates"][0]["content"]["parts"]:
            if "inlineData" in part:
                img_data = base64.b64decode(part["inlineData"]["data"])
                img_data = resize_to_note_size(img_data)
                Path(output_path).parent.mkdir(parents=True, exist_ok=True)
                with open(output_path, "wb") as f:
                    f.write(img_data)
                print(f"✅ 画像保存: {output_path}")
                return True

        print("❌ 画像データが見つかりませんでした")
        return False

    except Exception as e:
        print(f"❌ 画像生成エラー: {e}")
        return False


def make_thumbnail_prompt(title: str, topic: str) -> str:
    """note用サムネイルのプロンプト生成"""
    return (
        f"Create a YouTube-style thumbnail image for a Japanese tech blog article. "
        f"Title: '{title}'. Topic: {topic}. "
        f"Style: eye-catching design with large bold Japanese text overlay, "
        f"anime-inspired illustration style, dramatic background with tech elements "
        f"(code, AI, circuits), vibrant colors (blue/purple gradient). "
        f"16:9 aspect ratio, 1280x670px. High quality."
    )


def make_insert_prompt(section_title: str, topic: str) -> str:
    """挿絵のプロンプト生成"""
    return (
        f"Create an illustration for a Japanese tech blog article section titled '{section_title}'. "
        f"Topic: {topic}. "
        f"Style: clean, modern tech illustration. Flat design with subtle gradients. "
        f"16:9 aspect ratio, 1280x670px."
    )


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python generate_image.py <prompt> <output_path>")
        sys.exit(1)
    prompt = sys.argv[1]
    output = sys.argv[2]
    success = generate_image(prompt, output)
    sys.exit(0 if success else 1)
