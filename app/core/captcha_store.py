"""
登录图形验证码（内存存储，单实例有效；可后续替换为 Redis）

- 答案仅存 HMAC，不存明文；校验后立刻作废（一次性）。
- 与签发 IP 绑定，降低盗用 captcha_id 跨环境重放的风险。
"""
import hashlib
import hmac
import secrets
import threading
import time
from typing import Optional, Tuple

from app.core.config import settings

_store: dict = {}
_lock = threading.Lock()


def _ttl_seconds() -> int:
    return getattr(settings, "CAPTCHA_TTL_SECONDS", 180)


def _digest(captcha_id: str, answer_normalized: str) -> bytes:
    msg = f"{captcha_id}|{answer_normalized}".encode("utf-8")
    return hmac.new(settings.SECRET_KEY.encode("utf-8"), msg, hashlib.sha256).digest()


def store(captcha_id: str, answer_plain: str, client_ip: str) -> None:
    """写入验证码；answer_plain 应为生成图片时使用的原始字符（大写）。"""
    norm = (answer_plain or "").strip().upper()
    now = time.time()
    with _lock:
        _store[captcha_id] = {
            "h": _digest(captcha_id, norm),
            "expires_at": now + _ttl_seconds(),
            "ip": client_ip or "",
        }


def verify_and_consume(captcha_id: str, user_input: str, client_ip: str) -> Tuple[bool, str]:
    """
    校验并消费验证码（无论对错均作废，防重放）。
    返回 (是否通过, 错误原因码：ok / missing / expired / mismatch)
    """
    cid = (captcha_id or "").strip()
    if not cid:
        return False, "missing"

    norm = (user_input or "").strip().upper().replace(" ", "")
    if not norm:
        with _lock:
            _store.pop(cid, None)
        return False, "missing"

    with _lock:
        ent = _store.pop(cid, None)

    if not ent:
        return False, "expired"

    if time.time() > ent["expires_at"]:
        return False, "expired"

    if (client_ip or "") != (ent.get("ip") or ""):
        return False, "mismatch"

    cand = _digest(cid, norm)
    if not hmac.compare_digest(cand, ent["h"]):
        return False, "mismatch"

    return True, "ok"


def new_captcha_id() -> str:
    return secrets.token_urlsafe(24)


def cleanup_expired() -> None:
    now = time.time()
    with _lock:
        dead = [k for k, v in _store.items() if v.get("expires_at", 0) < now]
        for k in dead:
            _store.pop(k, None)
