"""
Token 黑名单：基于 jti 的内存黑名单，用于 access_token 即时失效。
登出、管理员禁用用户时将 jti 加入黑名单，验证 token 时检查。
自动清理过期条目，避免内存无限增长。
"""
import time
import threading
from typing import Dict

_blacklist: Dict[str, float] = {}
_lock = threading.Lock()
_CLEANUP_INTERVAL = 300


def add_to_blacklist(jti: str, ttl_seconds: int = 1800) -> None:
    """将 jti 加入黑名单，ttl_seconds 后自动过期（默认 30 分钟，与 access_token 有效期对齐）"""
    with _lock:
        _blacklist[jti] = time.time() + ttl_seconds


def is_blacklisted(jti: str) -> bool:
    """检查 jti 是否在黑名单中"""
    with _lock:
        expires_at = _blacklist.get(jti)
        if expires_at is None:
            return False
        if time.time() > expires_at:
            del _blacklist[jti]
            return False
        return True


def cleanup_expired() -> int:
    """清理已过期的黑名单条目，返回清理数量"""
    now = time.time()
    with _lock:
        expired = [jti for jti, exp in _blacklist.items() if now > exp]
        for jti in expired:
            del _blacklist[jti]
        return len(expired)


def blacklist_size() -> int:
    with _lock:
        return len(_blacklist)
