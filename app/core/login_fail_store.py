"""
登录失败按「用户名 + IP」单独计数与锁定（内存实现，可后续替换为 Redis）

- 同一 IP 对同一用户名的失败次数单独统计，达到阈值仅锁定该 (username, ip)，不影响其他 IP。
- 换 IP 再试同一用户名则重新计数。
"""
import time
import threading
from typing import Tuple, Optional

from app.core.config import settings

# key: "username|ip" -> {"count": int, "lock_until_ts": float or None}
_store: dict = {}
_lock = threading.Lock()

# 失败计数窗口：超过此时间未再失败则计数清零（秒）
_FAIL_WINDOW_SECONDS = 3600  # 1 小时


def _key(username: str, ip: str) -> str:
    return (username or "") + "|" + (ip or "")


def is_locked(username: str, ip: str) -> Tuple[bool, int]:
    """
    检查该 (username, ip) 是否处于锁定状态。
    返回 (是否锁定, 剩余秒数，0 表示未锁定)。
    """
    key = _key(username, ip)
    with _lock:
        ent = _store.get(key)
        if not ent:
            return False, 0
        lock_until = ent.get("lock_until_ts")
        if not lock_until or time.time() >= lock_until:
            return False, 0
        return True, max(0, int(lock_until - time.time()))


def get_fail_count(username: str, ip: str) -> int:
    """返回当前 (username, ip) 的失败次数（不含已锁定的情况，锁定视为已达阈值）。"""
    key = _key(username, ip)
    with _lock:
        ent = _store.get(key)
        if not ent:
            return 0
        if ent.get("lock_until_ts") and time.time() < ent["lock_until_ts"]:
            return settings.LOGIN_MAX_FAILS
        return ent.get("count", 0)


def record_fail(username: str, ip: str) -> bool:
    """
    记录一次失败，并可选地触发锁定。
    返回本次是否刚刚触发锁定（便于写日志与做滥用检测）。
    """
    key = _key(username, ip)
    now = time.time()
    lock_minutes = getattr(settings, "LOGIN_LOCK_MINUTES", 15)
    max_fails = getattr(settings, "LOGIN_MAX_FAILS", 15)

    with _lock:
        ent = _store.setdefault(key, {"count": 0, "lock_until_ts": None})
        # 若已在锁定期内，不再累加
        if ent.get("lock_until_ts") and now < ent["lock_until_ts"]:
            return False
        # 若锁定期已过，重新计数
        if ent.get("lock_until_ts") and now >= ent["lock_until_ts"]:
            ent["count"] = 0
            ent["lock_until_ts"] = None
        ent["count"] = ent["count"] + 1
        just_locked = False
        if ent["count"] >= max_fails:
            ent["lock_until_ts"] = now + lock_minutes * 60
            just_locked = True
        return just_locked


def clear(username: str, ip: str) -> None:
    """登录成功时清除该 (username, ip) 的失败记录与锁定。"""
    key = _key(username, ip)
    with _lock:
        _store.pop(key, None)


def clear_by_username(username: str) -> None:
    """管理员解封时，清除该用户名在所有 IP 下的失败记录与锁定。"""
    if not username:
        return
    prefix = (username or "") + "|"
    with _lock:
        to_del = [k for k in _store if k.startswith(prefix)]
        for k in to_del:
            _store.pop(k, None)


def cleanup_expired() -> None:
    """清理已过期的条目（可选定时调用）。"""
    now = time.time()
    with _lock:
        to_del = [
            k for k, v in _store.items()
            if v.get("lock_until_ts") and now >= v["lock_until_ts"]
        ]
        for k in to_del:
            _store.pop(k, None)
