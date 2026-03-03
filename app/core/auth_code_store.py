"""
OAuth2 授权码存储（内存实现，单实例有效；可后续替换为 Redis）
授权码一次性使用，默认 5 分钟有效。
"""
import secrets
import time
from typing import Optional, Dict, Any

# code -> { user_id, username, client_id, redirect_uri, state, expires_at_ts }
_auth_codes: Dict[str, Dict[str, Any]] = {}
_CODE_TTL_SECONDS = 300  # 5 分钟


def generate_authorization_code(
    user_id: int,
    username: str,
    client_id: str,
    redirect_uri: str,
    state: Optional[str] = None,
) -> str:
    code = secrets.token_urlsafe(32)
    _auth_codes[code] = {
        "user_id": user_id,
        "username": username,
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "state": state,
        "expires_at_ts": time.time() + _CODE_TTL_SECONDS,
    }
    return code


def consume_authorization_code(
    code: str,
    client_id: str,
    redirect_uri: str,
) -> Optional[Dict[str, Any]]:
    """验证并消费授权码，返回 user_id/username 或 None。redirect_uri 需一致。"""
    data = _auth_codes.pop(code, None)
    if not data:
        return None
    if time.time() > data["expires_at_ts"]:
        return None
    if data["client_id"] != client_id:
        return None
    if data["redirect_uri"] != redirect_uri:
        return None
    return {
        "user_id": data["user_id"],
        "username": data["username"],
    }


def cleanup_expired():
    """清理过期授权码（可按需定时调用）"""
    now = time.time()
    expired = [c for c, d in _auth_codes.items() if d["expires_at_ts"] < now]
    for c in expired:
        _auth_codes.pop(c, None)
