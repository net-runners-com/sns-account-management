#!/usr/bin/env python3
"""
instagrapi bridge: Node から subprocess 経由で IG mobile API を叩く窓口

production の 4 コマンドのみ:
    get-bearer               : Threads モード login → Threads-issued Bearer 取得 (DM 送信用)
    user-info <username>     : ユーザー情報 (interop_messaging_user_fbid 解決等)
    dm-threads [amount]      : DM 受信箱 thread 一覧
    dm-messages <id> [amount]: 指定 thread のメッセージ一覧

環境変数:
    INSTAGRAPI_ACCOUNT       : アカウント識別子 (任意の文字列, accounts/instagrapi_<name>.json と紐付く)
    INSTAGRAPI_USERNAME      : IG username (Threads username)
    INSTAGRAPI_PASSWORD      : IG password
    INSTAGRAPI_THREADS_MODE=1: login 前に X-IG-App-ID を Threads (Barcelona) に切替
                                Threads-issued Bearer が必要なときに必須
    INSTAGRAPI_PROXY         : (optional) http://user:pass@host:port

出力: 成功は stdout に JSON 1行, 失敗は exit !=0 + stderr にエラー
"""
import json
import os
import sys
import warnings
from pathlib import Path

warnings.filterwarnings("ignore")

from instagrapi import Client
from instagrapi.exceptions import (
    BadPassword,
    LoginRequired,
    ChallengeRequired,
    TwoFactorRequired,
    ClientError,
)

# accounts ディレクトリ (sns-analytics/accounts/)
# bridge.py は libs/threads-api/instagrapi-bridge/bridge.py に置かれる前提
# parents[0]=instagrapi-bridge, [1]=threads-api, [2]=libs, [3]=sns-analytics
ACCOUNTS_DIR = Path(os.environ.get("THREADS_ACCOUNTS_DIR") or
                    Path(__file__).resolve().parents[3] / "accounts")
ACCOUNTS_DIR.mkdir(parents=True, exist_ok=True)


def session_file(account: str) -> Path:
    return ACCOUNTS_DIR / f"instagrapi_{account}.json"


THREADS_APP_ID = "238260118697367"
BARCELONA_UA = os.environ.get("THREADS_BARCELONA_UA",
    "Barcelona 426.0.0.36.67 Android (36/14; 480dpi; 1080x2340; samsung; SM-S908N; b0q; qcom; en_US; 729123456)")


def _apply_threads_mode(cl: Client):
    """INSTAGRAPI_THREADS_MODE=1 のとき UA / X-IG-App-ID を Threads 仕様に切替.

    instagrapi の private_request は X-IG-App-ID を IG mobile (567067343352427) に
    上書きするため, requests.Session.send() レベルで monkey-patch して強制上書き.
    Bearer を Threads-issued にしたい場合は login の **前** に apply 必須.
    """
    if os.environ.get("INSTAGRAPI_THREADS_MODE") not in ("1", "true", "yes"):
        return
    cl.set_user_agent(BARCELONA_UA)
    cl.private.headers["X-IG-App-ID"] = THREADS_APP_ID
    cl.private.headers["User-Agent"] = BARCELONA_UA

    if not getattr(cl.private, "_threads_mode_patched", False):
        orig_send = cl.private.send

        def patched_send(request, **kwargs):
            request.headers["X-IG-App-ID"] = THREADS_APP_ID
            request.headers["User-Agent"] = BARCELONA_UA
            return orig_send(request, **kwargs)

        cl.private.send = patched_send
        cl.private._threads_mode_patched = True


def get_client(account: str, username: str, password: str) -> Client:
    """セッションファイル優先でロード, 切れてたら再 login.

    余計な warmup (get_timeline_feed 等) は呼ばない. instagrapi の login() は
    load_settings 後だと no-op で帰るので不要な API 呼び出しは省略 = challenge 抑制.
    """
    cl = Client()
    proxy = os.environ.get("INSTAGRAPI_PROXY")
    if proxy:
        cl.set_proxy(proxy)
    _apply_threads_mode(cl)  # ★ login 前に適用 (Bearer context を Threads に)

    sess = session_file(account)
    if sess.exists():
        try:
            cl.load_settings(sess)
            if cl.user_id:
                _apply_threads_mode(cl)
                return cl
            cl.login(username, password)
            cl.dump_settings(sess)
            _apply_threads_mode(cl)
            return cl
        except (LoginRequired, ClientError) as e:
            print(f"[bridge] session invalid ({type(e).__name__}: {e}), re-logging in", file=sys.stderr)
            cl.set_settings({})
            _apply_threads_mode(cl)

    cl.login(username, password)
    cl.dump_settings(sess)
    _apply_threads_mode(cl)
    return cl


def cmd_get_bearer(cl):
    """login 後の mobile Bearer + device IDs を返す.

    INSTAGRAPI_THREADS_MODE=1 で login すると Threads-issued Bearer が出る.
    BcnSendTextMessageMutation (DM 送信) はこの Bearer が必要.
    """
    bearer = cl.private.headers.get("Authorization") or cl.private.headers.get("authorization")
    settings = cl.get_settings()
    return {
        "bearer": bearer,
        "user_id": str(cl.user_id),
        "device_id": settings.get("device_id"),
        "uuid": settings.get("uuid"),
        "android_device_id": settings.get("android_device_id"),
        "phone_id": settings.get("phone_id"),
        "client_session_id": settings.get("client_session_id"),
    }


def cmd_user_info(cl, username):
    """username → ユーザー情報 (pk, full_name, follower_count 等)."""
    u = cl.user_info_by_username(username)
    return u.dict()


def cmd_dm_threads(cl, amount=20):
    """DM スレッド一覧 (受信箱)."""
    threads = cl.direct_threads(amount=int(amount))
    return [t.dict() for t in threads]


def cmd_dm_messages(cl, thread_id, amount=20):
    """指定スレッドのメッセージ一覧."""
    msgs = cl.direct_messages(thread_id, amount=int(amount))
    return [m.dict() for m in msgs]


def cmd_photo_upload(cl, image_path):
    """画像を rupload_igphoto に upload して upload_id を返す.

    BcnSendPhotoMessageMutation の variables.upload_id に渡す値を生成.
    返り値: { "upload_id", "width", "height", "size_bytes", "filename" }
    """
    from pathlib import Path
    p = Path(image_path)
    if not p.exists():
        raise RuntimeError(f"image not found: {image_path}")
    upload_id, width, height = cl.photo_rupload(p)
    return {
        "upload_id": upload_id,
        "width": int(width),
        "height": int(height),
        "size_bytes": p.stat().st_size,
        "filename": p.name,
    }


def cmd_photo_post(cl, image_path, *caption_words):
    """画像投稿 (Threads-mode で instagrapi photo_upload 呼び出し).

    INSTAGRAPI_THREADS_MODE=1 で UA / X-IG-App-ID が Threads 仕様 → Threads feed に投稿.
    """
    from pathlib import Path
    p = Path(image_path)
    if not p.exists():
        raise RuntimeError(f"image not found: {image_path}")
    caption = " ".join(caption_words)
    media = cl.photo_upload(p, caption=caption)
    return media.dict() if hasattr(media, "dict") else {"sent": True, "result": str(media)[:300]}


def cmd_like(cl, media_id):
    """media_id (pk) にいいね. instagrapi mobile API 経由で web の bot 検出を回避."""
    ok = cl.media_like(str(media_id))
    return {"ok": bool(ok), "media_id": str(media_id)}


def cmd_reply(cl, media_id, *text_words):
    """media_id (pk) に Threads 返信. /api/v1/media/configure_text_only_post/ を直叩き.

    Threads の reply は IG の comment ではなく top-level post + reply_id で行う.
    instagrapi に専用 API がないため private_request で構築.
    """
    import time
    import json as _json
    text = " ".join(text_words)
    if not text:
        raise RuntimeError("reply text required")

    timezone_offset = -28800
    publish_mode = "text_post"
    upload_id = str(int(time.time() * 1000))
    text_post_app_info = {
        "reply_id": str(media_id),
        "reply_control": 0,
    }
    data = {
        "publish_mode": publish_mode,
        "text_post_app_info": _json.dumps(text_post_app_info, separators=(",", ":")),
        "timezone_offset": str(timezone_offset),
        "upload_id": upload_id,
        "caption": text,
        "_uid": str(cl.user_id),
        "_uuid": cl.uuid,
    }
    result = cl.private_request("media/configure_text_only_post/", data=data)
    return {"ok": result.get("status") == "ok", "media_pk": (result.get("media") or {}).get("pk"), "raw": result}


def cmd_dm_send_photo(cl, image_path, *recipients):
    """画像 DM 送信 (instagrapi direct_send_photo 経由, IG mobile REST API).

    注意: IG Direct には届くが Threads DM タブに届くかは要検証 (テキスト DM 同様の制約).
    確実に Threads タブに送りたいなら Node 側の sendPhotoDM (BcnSendPhotoMessageMutation) を使う.

    引数: <image_path> <username_or_user_id> [...]
    """
    from pathlib import Path
    p = Path(image_path)
    if not p.exists():
        raise RuntimeError(f"image not found: {image_path}")
    if not recipients:
        raise RuntimeError("at least one recipient required")
    # username → user_id resolution
    user_ids = []
    for t in recipients:
        s = str(t).lstrip("@")
        if s.isdigit():
            user_ids.append(int(s))
        else:
            u = cl.user_info_by_username(s)
            user_ids.append(int(u.pk))
    res = cl.direct_send_photo(p, user_ids=user_ids)
    return res.dict() if hasattr(res, "dict") else {"sent": True, "result": str(res)[:200]}


def cmd_dm_send(cl, *args):
    """テキスト DM 送信 (instagrapi direct_send 経由, IG mobile REST API).

    使い方: dm-send <recipient_user_id_or_username> <text...>
    複数 recipient は不可 (1:1 のみ). text は 2nd 引数以降全部スペース結合.
    IG モード必須 (Threads モードでは direct API が 404).
    """
    if len(args) < 2:
        raise RuntimeError("usage: dm-send <user_id_or_username> <text...>")
    target = str(args[0]).lstrip("@")
    text = " ".join(args[1:])
    if target.isdigit():
        user_id = int(target)
    else:
        u = cl.user_info_by_username(target)
        user_id = int(u.pk)
    res = cl.direct_send(text, user_ids=[user_id])
    return res.dict() if hasattr(res, "dict") else {"sent": True, "result": str(res)[:200]}


def cmd_text_app_notifications(cl: Client, max_id: str = ""):
    """Threads アプリのアクティビティフィード (mobile REST 経由).

    Frida capture で見えてた IgApi: text_feed/text_app_notifications/ を
    instagrapi の private_request 経由で叩く. instagrapi の session は
    X-Pigeon-Session-Id / X-IG-Family-Device-ID 等の per-device header を
    自動付与してくれるので Node 側で再構築不要.

    返り値: 生 JSON.
    """
    params = {}
    if max_id:
        params["max_id"] = max_id
    return cl.private_request("text_feed/text_app_notifications/", params=params)


def cmd_inbox_native(cl: Client, *_):
    """Threads native DM の inbox / threads / messages を IG-mobile slide_* 経由で取得試行.

    instagrapi 経由の通常 DM API (direct_v2/inbox/) は Threads-mode session で
    HTTP 404 (= Threads native は別系統). ここでは Threads アプリ自身が叩いてる
    `slide_threads/` 系の REST endpoint を試行する.
    """
    candidates = [
        "slide_threads/",
        "slide_inbox/",
        "text_feed/inbox/",
    ]
    out = {}
    for ep in candidates:
        try:
            r = cl.private_request(ep)
            out[ep] = {"ok": True, "data": r}
        except Exception as e:
            out[ep] = {"ok": False, "error": f"{type(e).__name__}: {e}"}
    return out


COMMANDS = {
    "get-bearer":              (cmd_get_bearer, 0),
    "user-info":               (cmd_user_info, 1),
    "dm-threads":              (cmd_dm_threads, 0),
    "dm-messages":             (cmd_dm_messages, 1),
    "photo-upload":            (cmd_photo_upload, 1),
    "photo-post":              (cmd_photo_post, 1),
    "dm-send-photo":           (cmd_dm_send_photo, 2),
    "dm-send":                 (cmd_dm_send, 2),
    "like":                    (cmd_like, 1),
    "reply":                   (cmd_reply, 2),
    "text-app-notifications":  (cmd_text_app_notifications, 0),
    "inbox-native-probe":      (cmd_inbox_native, 0),
}


def main(argv):
    if len(argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    cmd = argv[1]
    args = argv[2:]
    if cmd not in COMMANDS:
        print(f"unknown command: {cmd} (available: {', '.join(COMMANDS)})", file=sys.stderr)
        return 2

    fn, min_args = COMMANDS[cmd]
    if len(args) < min_args:
        print(f"command '{cmd}' requires at least {min_args} args", file=sys.stderr)
        return 2

    account = os.environ.get("INSTAGRAPI_ACCOUNT") or os.environ.get("THREADS_ACCOUNT")
    username = os.environ.get("INSTAGRAPI_USERNAME") or os.environ.get("THREADS_USERNAME")
    password = os.environ.get("INSTAGRAPI_PASSWORD") or os.environ.get("THREADS_PASSWORD")
    if not account:
        print("INSTAGRAPI_ACCOUNT (or THREADS_ACCOUNT) required", file=sys.stderr)
        return 2
    if not username or not password:
        print("INSTAGRAPI_USERNAME / INSTAGRAPI_PASSWORD (or THREADS_*) required", file=sys.stderr)
        return 2

    try:
        cl = get_client(account, username, password)
    except (BadPassword, ChallengeRequired, TwoFactorRequired) as e:
        print(json.dumps({"error": type(e).__name__, "message": str(e)}), file=sys.stderr)
        return 3
    except Exception as e:
        print(f"[bridge] login failed: {type(e).__name__}: {e}", file=sys.stderr)
        return 1

    try:
        result = fn(cl, *args) if args else fn(cl)
    except Exception as e:
        print(json.dumps({"error": type(e).__name__, "message": str(e)}), file=sys.stderr)
        return 4

    sys.stdout.write(json.dumps(result, default=str, ensure_ascii=False))
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
