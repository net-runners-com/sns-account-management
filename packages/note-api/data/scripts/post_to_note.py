#!/usr/bin/env python3
"""Browser Use CLI を使って note.com に記事を下書き保存するスクリプト"""

import subprocess
import sys
import os
import time
import re
import base64
from pathlib import Path

# .env 読み込み
env_path = Path(__file__).resolve().parents[4] / ".env"
if env_path.exists():
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())

BROWSER_USE = os.path.expanduser("~/.browser-use-env/bin/browser-use")
CHROME_PROFILE = "Profile 1"  # デフォルトプロファイル


def set_profile(profile: str):
    """Chromeプロファイルを切り替える"""
    global CHROME_PROFILE
    CHROME_PROFILE = profile


def run(cmd: str, check: bool = True) -> str:
    """browser-use コマンドを実行"""
    full_cmd = f'{BROWSER_USE} --headed --profile "{CHROME_PROFILE}" {cmd}'
    print(f"  $ browser-use {cmd[:100]}...")
    result = subprocess.run(full_cmd, shell=True, capture_output=True, text=True)
    if check and result.returncode != 0:
        print(f"  ⚠ stderr: {result.stderr[:300]}")
    return result.stdout.strip()


def wait(sec: float = 1.5):
    time.sleep(sec)


def get_state() -> str:
    return run("state", check=False)


def find_index(state: str, keyword: str) -> str:
    """
    stateから指定キーワードを含む要素のインデックスを探す。
    ボタンのテキストが次の行にある形式にも対応:
      [27]<button id=:r6: />
          下書き保存
    """
    lines = state.split("\n")
    for i, line in enumerate(lines):
        # 同じ行にキーワードがある
        if keyword in line:
            m = re.search(r"\[(\d+)\]", line)
            if m:
                return m.group(1)
        # キーワードが次の行にある → 前の行からインデックスを取る
        if i > 0 and keyword in line:
            prev = lines[i - 1]
            m = re.search(r"\[(\d+)\]", prev)
            if m:
                return m.group(1)
    # 2段階目: キーワードが含まれる行の直前行を再度チェック
    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped == keyword or keyword in stripped:
            # 前後5行以内でインデックスを探す
            for j in range(max(0, i - 3), i + 1):
                m = re.search(r"\[(\d+)\]", lines[j])
                if m:
                    return m.group(1)
    return ""


def copy_to_clipboard(text: str):
    """macOS クリップボードにテキストをコピー"""
    proc = subprocess.run(["pbcopy"], input=text.encode("utf-8"), check=True)


def markdown_to_html(md: str) -> str:
    """Markdownを note エディタ用HTMLに変換"""
    lines = md.split("\n")
    html_parts = []
    in_code = False
    code_buf = []
    list_buf = []

    def flush_list():
        """溜まったリストアイテムをHTMLに変換"""
        if list_buf:
            items = "".join(f"<li>{item}</li>" for item in list_buf)
            html_parts.append(f"<ul>{items}</ul>")
            list_buf.clear()

    def inline_format(text: str) -> str:
        """インライン装飾（太字・斜体）を変換"""
        text = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', text)
        text = re.sub(r'\*(.+?)\*', r'<i>\1</i>', text)
        return text

    for line in lines:
        if line.startswith("```"):
            flush_list()
            if in_code:
                code_text = "\n".join(code_buf)
                html_parts.append(f"<pre><code>{code_text}</code></pre>")
                code_buf = []
                in_code = False
            else:
                in_code = True
            continue

        if in_code:
            code_buf.append(line)
            continue

        # 見出し
        if line.startswith("### "):
            flush_list()
            html_parts.append(f"<h4>{inline_format(line[4:])}</h4>")
        elif line.startswith("## "):
            flush_list()
            html_parts.append(f"<h3>{inline_format(line[3:])}</h3>")
        elif line.startswith("# "):
            flush_list()
            html_parts.append(f"<h2>{inline_format(line[2:])}</h2>")
        # 引用
        elif line.startswith("> "):
            flush_list()
            html_parts.append(f"<blockquote>{inline_format(line[2:])}</blockquote>")
        # リスト
        elif line.startswith("- ") or line.startswith("* "):
            list_buf.append(inline_format(line[2:]))
        # 空行
        elif line.strip() == "":
            flush_list()
            html_parts.append("<br>")
        # 通常段落
        else:
            flush_list()
            html_parts.append(f"<p>{inline_format(line)}</p>")

    flush_list()
    return "".join(html_parts)


def insert_paid_area_divider():
    """「+」メニューから「有料エリア指定」ブロックを挿入する"""
    print("  有料エリア指定ブロックを挿入中...")

    # エディタ末尾にカーソルを置く
    js_focus = (
        "const el=document.querySelector('[contenteditable=true][role=textbox]');"
        "if(el){"
        "el.focus();"
        "const r=document.createRange();"
        "r.selectNodeContents(el);"
        "r.collapse(false);"
        "const s=window.getSelection();"
        "s.removeAllRanges();"
        "s.addRange(r);"
        "}"
    )
    run(f'eval "{js_focus}"')
    wait(0.5)

    # state から「+」ボタンを探してクリック
    state = get_state()
    plus_idx = find_index(state, "有料エリア指定")
    if plus_idx:
        # 直接「有料エリア指定」が見える場合
        run(f"click {plus_idx}")
        wait(1)
        print("  ✅ 有料エリア指定を直接クリック")
        return

    # 「+」(挿入)ボタンを探す
    plus_btn_idx = ""
    for keyword in ["+", "挿入", "ブロックを追加"]:
        plus_btn_idx = find_index(state, keyword)
        if plus_btn_idx:
            break

    if plus_btn_idx:
        run(f"click {plus_btn_idx}")
        wait(1)
        state2 = get_state()
        paid_idx = find_index(state2, "有料エリア指定")
        if paid_idx:
            run(f"click {paid_idx}")
            wait(1)
            print("  ✅ +メニューから有料エリア指定を挿入")
            return

    # JS fallback: ボタンを直接探してクリック
    js_click = (
        "const btn=Array.from(document.querySelectorAll('button,li,[role=menuitem]'))"
        ".find(b=>b.textContent.trim()==='有料エリア指定');"
        "if(btn){btn.click();'clicked';}else{'not found';}"
    )
    result = run(f'eval "{js_click}"')
    wait(1)
    print(f"  JS fallback結果: {result}")


def set_paid(price: int):
    """公開ページに遷移して有料記事の価格を設定する"""
    print(f"\n=== Step 4.5: Set paid article (¥{price}) ===")

    navigate_to_publish()

    # 公開設定ページで有料ラジオボタンを探してクリック
    state2 = get_state()
    print(f"  Publish page state length: {len(state2)}")

    # 「有料」ラジオボタンをクリック
    paid_idx = find_index(state2, "有料")
    if paid_idx:
        run(f"click {paid_idx}")
        wait(1)
        print(f"  有料ラジオボタンをクリック (index {paid_idx})")
    else:
        # JS fallback: ラジオボタンやラベルを探す
        js_paid = (
            "const labels=Array.from(document.querySelectorAll('label,span,div,button'));"
            "const paid=labels.find(l=>l.textContent.trim()==='有料');"
            "if(paid){paid.click();'clicked';}else{'not found';}"
        )
        result = run(f'eval "{js_paid}"')
        wait(1)
        print(f"  JS fallback 有料選択: {result}")

    # 価格入力欄に金額を設定
    wait(0.5)
    state3 = get_state()
    price_idx = ""
    for kw in ["価格", "円", "金額", "price"]:
        price_idx = find_index(state3, kw)
        if price_idx:
            break

    if price_idx:
        run(f"click {price_idx}")
        wait(0.3)
        run(f'input {price_idx} "{price}"')
        wait(0.5)
        print(f"  価格 ¥{price} を入力 (index {price_idx})")
    else:
        # JS fallback: input[type=number] や price関連のinputを探す
        js_price = (
            f"const inputs=Array.from(document.querySelectorAll('input'));"
            f"const pi=inputs.find(i=>i.type==='number'||i.placeholder.includes('価格')||i.placeholder.includes('円')||i.name.includes('price'));"
            f"if(pi){{pi.focus();pi.value='{price}';pi.dispatchEvent(new Event('input',{{bubbles:true}}));pi.dispatchEvent(new Event('change',{{bubbles:true}}));'set';}}"
            f"else{{'not found';}}"
        )
        result = run(f'eval "{js_price}"')
        wait(0.5)
        print(f"  JS fallback 価格入力: {result}")

    print(f"  ✅ 有料記事設定完了 (¥{price})")


def navigate_to_publish():
    """エディタから公開ページへ遷移する"""
    state = get_state()
    publish_idx = find_index(state, "公開に進む")
    if publish_idx:
        run(f"click {publish_idx}")
        wait(3)
        print("  公開ページへ遷移")
    else:
        js = (
            "const btn=Array.from(document.querySelectorAll('button'))"
            ".find(b=>b.textContent.includes('公開に進む'));"
            "if(btn){btn.click();'clicked';}else{'not found';}"
        )
        run(f'eval "{js}"')
        wait(3)
        print("  JS fallback で公開ページへ遷移")


def publish_article():
    """公開ページで「公開」ボタンをクリックして記事を公開する"""
    state = get_state()
    # 「公開」ボタンを探す（「公開に進む」ではなく「公開」単体）
    # 「投稿する」「公開する」「公開」などの表現を試す
    pub_idx = ""
    for kw in ["投稿する", "公開する", "公開"]:
        pub_idx = find_index(state, kw)
        if pub_idx:
            break
    if pub_idx:
        run(f"click {pub_idx}")
        wait(3)
        print(f"  ✅ 記事を公開しました (index {pub_idx})")
    else:
        js = (
            "const btns=Array.from(document.querySelectorAll('button'));"
            "const pub=btns.find(b=>{const t=b.textContent.trim();return t==='投稿する'||t==='公開する'||t==='公開';});"
            "if(pub){pub.click();'clicked';}else{'not found';}"
        )
        result = run(f'eval "{js}"')
        wait(3)
        print(f"  JS fallback 公開: {result}")


def insert_embed_block(url: str):
    """note エディタで URL を「埋め込み」ブロックとして末尾に挿入する。
    挿入メニュー（+ボタン）→「埋め込み」→URL入力→確定 の流れを実行。
    """
    print(f"\n  --- Embed挿入: {url[:60]} ---")

    # (a) エディタ末尾にフォーカス + 新規空段落を作る
    js_focus = (
        "(function(){"
        "const el=document.querySelector('[contenteditable=true][role=textbox]');"
        "if(!el)return 'no editor';"
        "el.focus();"
        "const r=document.createRange();"
        "r.selectNodeContents(el);"
        "r.collapse(false);"
        "const s=window.getSelection();"
        "s.removeAllRanges();"
        "s.addRange(r);"
        "document.execCommand('insertParagraph');"
        "return 'focused';"
        "})()"
    )
    run(f'eval "{js_focus}"', check=False)
    wait(1)

    # (b) 挿入メニュー（+ボタン）を開く。aria-label や title でマッチ
    js_open_menu = (
        "(function(){"
        "const btns=document.querySelectorAll('button');"
        "for(const b of btns){"
        "const al=(b.getAttribute('aria-label')||'')+'|'+(b.title||'');"
        "if(al.includes('挿入')||al.includes('ブロック')||al.includes('メニュー')){"
        "b.click();return 'opened:'+al;"
        "}}"
        "return 'plus button not found';"
        "})()"
    )
    result = run(f'eval "{js_open_menu}"', check=False)
    print(f"    + menu: {result}")
    wait(1)

    # (c) 「埋め込み」を選択 — state から見つけてクリック、JS fallback
    state = get_state()
    embed_idx = find_index(state, "埋め込み")
    if embed_idx:
        run(f"click {embed_idx}")
        print(f"    埋め込みクリック (index {embed_idx})")
    else:
        result = run('eval "const it=Array.from(document.querySelectorAll(\'button,li,a,div[role=menuitem]\')).find(e=>e.textContent.trim()===\'埋め込み\');if(it){it.click();\'clicked\';}else{\'not found\';}"', check=False)
        print(f"    埋め込みJS: {result}")
    wait(2)

    # (d) URL 入力欄を探して URL を入れる
    state = get_state()
    url_idx = find_index(state, "URL") or find_index(state, "http")
    if url_idx:
        run(f'input {url_idx} "{url}"')
        print(f"    URL入力 (index {url_idx})")
    else:
        url_esc = url.replace("'", "\\'")
        js_input = (
            "(function(){"
            "const inputs=document.querySelectorAll('input[type=text],input[type=url],input:not([type])');"
            "for(const i of inputs){"
            "const ph=i.placeholder||'';"
            "if(ph.includes('URL')||ph.includes('http')||ph.includes('リンク')){"
            f"i.focus();i.value='{url_esc}';"
            "i.dispatchEvent(new Event('input',{bubbles:true}));"
            "i.dispatchEvent(new Event('change',{bubbles:true}));"
            "return 'input:'+ph;"
            "}}"
            "return 'no input';"
            "})()"
        )
        result = run(f'eval "{js_input}"', check=False)
        print(f"    URL入力JS: {result}")
    wait(3)  # note側 URL fetch 待ち

    # (e) 確定ボタン（「OK」「確定」「完了」「挿入」）
    state = get_state()
    confirm_idx = ""
    for kw in ["OK", "確定", "挿入する", "完了"]:
        confirm_idx = find_index(state, kw)
        if confirm_idx:
            break
    if confirm_idx:
        run(f"click {confirm_idx}")
        print(f"    確定 (index {confirm_idx})")
    else:
        # Enter キー
        run('keys "Enter"', check=False)
        print(f"    Enter送信でconfirm試行")

    wait(4)  # 埋め込みカード レンダリング待ち
    print(f"    ✅ 埋め込み完了（要確認）")


def post_to_note(title: str, body_md: str, thumbnail_path: str = "", insert_images: dict = None, price: int = 0, publish: bool = False, embed_urls=None):
    """note.com に記事を投稿（下書き保存）"""
    insert_images = insert_images or {}
    embed_urls = embed_urls or []

    # === Step 1: エディタを開く ===
    print(f"\n=== Step 1: Open editor (Chrome {CHROME_PROFILE}) ===")
    run("open https://editor.note.com/new")
    wait(3)
    # ウィンドウリサイズ（viewport 7px問題の回避）
    run('eval "window.resizeTo(1400,900);"', check=False)
    wait(1)
    run("open https://editor.note.com/new")
    wait(8)
    print("Editor loaded.")

    # stateを取得して要素インデックスを確認
    state = get_state()
    print(f"  Page title check: {'記事編集' in state or 'editor' in state.lower()}")
    print(f"  Viewport: {state.split(chr(10))[1] if len(state.split(chr(10))) > 1 else 'unknown'}")

    # === Step 2: タイトル入力 ===
    print(f"\n=== Step 2: Set title ===")
    print(f"  Title: {title}")

    # タイトルtextareaを探す（Shadow DOM内だがindexでアクセス可能）
    title_idx = find_index(state, "記事タイトル")
    if not title_idx:
        title_idx = find_index(state, "タイトル")

    if title_idx:
        run(f"click {title_idx}")
        wait(0.5)
        run(f'input {title_idx} "{title}"')
        wait(0.5)
        print(f"  Title set via index {title_idx}")
    else:
        # JS fallback: Shadow DOM をまたいでtextareaを操作
        js = (
            "const host = document.querySelector('[class*=title]') || document.querySelector('[class*=Title]');"
            "const textarea = host && host.shadowRoot ? host.shadowRoot.querySelector('textarea') : document.querySelector('textarea[placeholder]');"
            f"if(textarea) {{ textarea.focus(); textarea.value = '{title.replace(chr(39), chr(92)+chr(39))}'; textarea.dispatchEvent(new Event('input', {{bubbles:true}})); }}"
        )
        run(f'eval "{js}"')
        wait(0.5)
        print("  Title set via JS fallback")

    # === Step 3: 目次を挿入（本文より先に） ===
    print("\n=== Step 3: Insert table of contents ===")

    # エディタにフォーカス
    run('eval "const el=document.querySelector(\'[contenteditable=true][role=textbox]\');if(el){el.focus();}"')
    wait(1)

    # toc-setting ボタンをJSで直接クリック（最も確実）
    result = run('eval "const btn=document.getElementById(\'toc-setting\');if(btn){btn.click();\'clicked\';}else{\'not found\';}"')
    wait(1)
    print(f"  目次挿入: {result}")

    # 目次の後にカーソルを置く（本文挿入用）
    wait(0.5)
    run('eval "const el=document.querySelector(\'[contenteditable=true][role=textbox]\');if(el){el.focus();const r=document.createRange();r.selectNodeContents(el);r.collapse(false);const s=window.getSelection();s.removeAllRanges();s.addRange(r);}"')
    wait(0.3)

    # === Step 4: 本文入力（HTML経由でリッチテキスト挿入） ===
    print("\n=== Step 4: Set body content ===")

    body_html = markdown_to_html(body_md)

    # base64エンコード（シェルエスケープ問題を回避）
    b64 = base64.b64encode(body_html.encode("utf-8")).decode("ascii")

    # JS: デコードしてeditorにinsertHTMLで挿入（見出し・太字・引用を保持）
    js = (
        f"(function(){{"
        f"const b='{b64}';"
        f"const bytes=Uint8Array.from(atob(b),c=>c.charCodeAt(0));"
        f"const html=new TextDecoder().decode(bytes);"
        f"const el=document.querySelector('[contenteditable=true][role=textbox]');"
        f"if(el){{"
        f"el.focus();"
        f"const r=document.createRange();"
        f"r.selectNodeContents(el);"
        f"r.collapse(false);"
        f"const s=window.getSelection();"
        f"s.removeAllRanges();"
        f"s.addRange(r);"
        f"document.execCommand('insertHTML',false,html);"
        f"console.log('body inserted as HTML, length='+html.length);"
        f"}}else{{console.log('editor not found');}}"
        f"}})();"
    )

    run(f'eval "{js}"')
    wait(1.5)
    print(f"  Body content inserted via HTML ({len(body_html)} chars)")

    # === Step 4.5: 埋め込みURL挿入（CTA末尾の自己紹介ポストなど）===
    if embed_urls:
        print(f"\n=== Step 4.5: Insert embed blocks ({len(embed_urls)} URLs) ===")
        for url in embed_urls:
            insert_embed_block(url)

    # === Step 5: サムネイルアップロード（オプション）===
    if thumbnail_path and Path(thumbnail_path).exists():
        print(f"\n=== Step 5: Upload thumbnail ===")
        state2 = get_state()
        idx = find_index(state2, "画像を追加")
        if idx:
            run(f"click {idx}")
            wait(1)
            state3 = get_state()
            idx2 = find_index(state3, "画像をアップロード")
            if not idx2:
                idx2 = find_index(state3, "アップロード")
            if idx2:
                run(f"click {idx2}")
                wait(1)
            state4 = get_state()
            file_idx = find_index(state4, "note-editor-eyecatch-input")
            if not file_idx:
                file_idx = find_index(state4, "file")
            if file_idx:
                run(f"upload {file_idx} {thumbnail_path}")
                wait(2)
                state5 = get_state()
                save_idx = find_index(state5, "保存")
                if save_idx:
                    run(f"click {save_idx}")
                    wait(2)
                print(f"  ✅ Thumbnail uploaded")
            else:
                print("  ⚠ file input が見つかりませんでした")
        else:
            print("  ⚠ サムネイルボタンが見つかりませんでした")
    else:
        print("\n=== Step 5: Skip thumbnail ===")

    # === Step 5.5: 有料記事設定（price > 0 の場合）===
    already_on_publish = False
    if price > 0:
        set_paid(price)
        already_on_publish = True

    # === Step 6: 公開 or 下書き保存 ===
    if publish:
        print("\n=== Step 5: Publish article ===")
        if not already_on_publish:
            navigate_to_publish()
        publish_article()
    else:
        if already_on_publish:
            # 公開ページには下書き保存がない → キャンセルでエディタに戻る
            print("\n=== Step 5: Back to editor, then save draft ===")
            state_final = get_state()
            cancel_idx = find_index(state_final, "キャンセル")
            if cancel_idx:
                run(f"click {cancel_idx}")
                wait(3)
                print("  エディタに戻りました")
            else:
                js = (
                    "const btn=Array.from(document.querySelectorAll('button'))"
                    ".find(b=>b.textContent.includes('キャンセル'));"
                    "if(btn){btn.click();'clicked';}else{'not found';}"
                )
                run(f'eval "{js}"')
                wait(3)
                print("  JS fallback でエディタに戻りました")
            # エディタで下書き保存
            state_editor = get_state()
            draft_idx = find_index(state_editor, "下書き保存")
            if draft_idx:
                run(f"click {draft_idx}")
                wait(2)
                print(f"✅ Draft saved! (index {draft_idx})")
            else:
                run('eval "const btn=Array.from(document.querySelectorAll(\'button\')).find(b=>b.textContent.trim()===\'下書き保存\');if(btn)btn.click();else console.log(\'not found\');"')
                wait(2)
                print("  JS fallback で下書き保存を試みました")
        else:
            # エディタページから下書き保存
            print("\n=== Step 5: Save draft ===")
            state_final = get_state()
            draft_idx = find_index(state_final, "下書き保存")
            if draft_idx:
                run(f"click {draft_idx}")
                wait(2)
                print(f"✅ Draft saved! (index {draft_idx})")
            else:
                print("  stateで見つからなかったのでJSで保存試行...")
                # ページ状態を確認
                url_check = run('eval "document.title + \' | \' + location.href"', check=False)
                print(f"  現在のページ: {url_check}")
                wait(3)
                # まずボタン一覧を確認
                btn_list = run('eval "JSON.stringify(Array.from(document.querySelectorAll(\'button\')).filter(b=>b.textContent.trim()).map(b=>b.textContent.trim().slice(0,20)))"', check=False)
                print(f"  ボタン一覧: {btn_list[:300]}")
                result = run('eval "const btn=Array.from(document.querySelectorAll(\'button\')).find(b=>b.textContent.includes(\'下書き保存\'));if(btn){btn.click();\'clicked\';}else{\'not found\';}"')
                print(f"  JS fallback結果: {result}")
                wait(2)

    run("close")
    print("\n完了！")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python post_to_note.py <title> <body_markdown_file> [thumbnail_path]")
        sys.exit(1)

    # Usage: post_to_note.py <title> <body.md> [thumbnail] [--price 300] [--publish] [--profile "Profile 3"] [--embed URL]...
    title = sys.argv[1]
    body_file = Path(sys.argv[2])
    thumbnail = ""
    price = 0
    do_publish = False
    embed_urls = []

    remaining = sys.argv[3:]
    i = 0
    while i < len(remaining):
        if remaining[i] == "--price" and i + 1 < len(remaining):
            price = int(remaining[i + 1])
            i += 2
        elif remaining[i] == "--publish":
            do_publish = True
            i += 1
        elif remaining[i] == "--profile" and i + 1 < len(remaining):
            set_profile(remaining[i + 1])
            i += 2
        elif remaining[i] == "--embed" and i + 1 < len(remaining):
            embed_urls.append(remaining[i + 1])
            i += 2
        else:
            if not thumbnail:
                thumbnail = remaining[i]
            i += 1

    print(f"  Chrome Profile: {CHROME_PROFILE}")
    if embed_urls:
        print(f"  埋め込みURL: {len(embed_urls)}件")

    if not body_file.exists():
        print(f"❌ ファイルが見つかりません: {body_file}")
        sys.exit(1)

    body_md = body_file.read_text(encoding="utf-8")
    post_to_note(title, body_md, thumbnail, price=price, publish=do_publish, embed_urls=embed_urls)
