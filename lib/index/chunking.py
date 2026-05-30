"""Markdown を見出し単位 → 文字数単位で分割（small chunk）。"""
import re


def split_frontmatter(text: str):
    if text.startswith("---"):
        m = re.match(r"^---\s*\n(.*?)\n---\s*\n?(.*)$", text, re.S)
        if m:
            return m.group(1), m.group(2)
    return "", text


def _sections(body: str):
    secs, head, buf = [], "", []
    for ln in body.splitlines():
        if re.match(r"^#{1,6}\s", ln):
            if buf:
                secs.append((head, "\n".join(buf).strip()))
                buf = []
            head = ln.lstrip("#").strip()
        else:
            buf.append(ln)
    if buf:
        secs.append((head, "\n".join(buf).strip()))
    return [(h, c) for h, c in secs if c]


def chunk_markdown(text: str, size: int, overlap: int):
    """戻り値: (frontmatter, [(heading, content), ...])"""
    fm, body = split_frontmatter(text)
    out = []
    for head, content in _sections(body):
        if len(content) <= size:
            out.append((head, content))
        else:
            start, step = 0, max(1, size - overlap)
            while start < len(content):
                out.append((head, content[start:start + size]))
                start += step
    if not out:
        body = body.strip()
        if body:
            out.append(("", body[:size]))
    return fm, out
