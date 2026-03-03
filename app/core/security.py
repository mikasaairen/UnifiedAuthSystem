"""
密码加密、JWT令牌生成

实现要点（中文注释尽量写清）：
- 密码：bcrypt 加盐哈希，存 hashed_password
- access token：短期有效，不落库
- refresh token：长期有效，落库只存 hash，可撤销（登出/风控）
- token payload：包含 sub(username)、token_type(access/refresh)、jti、exp
"""
from datetime import datetime, timedelta
from typing import Optional, Tuple
import secrets

from jose import jwt
from passlib.context import CryptContext
import bcrypt
from app.core.config import settings

# 配置 bcrypt 上下文
# 注意：passlib 在某些版本下可能有版本检测问题，我们直接使用 bcrypt 作为后备
try:
    pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
    # 强制设置后端，避免版本检测问题
    pwd_context._config.setdefault('bcrypt__ident', '2b')
except Exception:
    # 如果 passlib 有问题，直接使用 bcrypt
    pwd_context = None


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """
    验证密码
    注意：bcrypt 限制密码长度为 72 字节，超长密码会被截断
    """
    # bcrypt 限制密码长度为 72 字节
    password_bytes = plain_password.encode('utf-8')
    if len(password_bytes) > 72:
        password_bytes = password_bytes[:72]
        plain_password = password_bytes.decode('utf-8', errors='ignore')
    
    # 如果 passlib 可用，使用 passlib
    if pwd_context:
        try:
            return pwd_context.verify(plain_password, hashed_password)
        except Exception:
            pass
    
    # 后备方案：直接使用 bcrypt
    try:
        return bcrypt.checkpw(password_bytes, hashed_password.encode('utf-8'))
    except Exception:
        return False


def get_password_hash(password: str) -> str:
    """
    获取密码哈希值
    注意：bcrypt 限制密码长度为 72 字节，超长密码会被截断
    """
    # bcrypt 限制密码长度为 72 字节
    password_bytes = password.encode('utf-8')
    if len(password_bytes) > 72:
        password_bytes = password_bytes[:72]
        password = password_bytes.decode('utf-8', errors='ignore')
    
    # 如果 passlib 可用，使用 passlib
    if pwd_context:
        try:
            return pwd_context.hash(password)
        except Exception:
            pass
    
    # 后备方案：直接使用 bcrypt
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password_bytes, salt)
    return hashed.decode('utf-8')


def hash_token(token: str) -> str:
    """
    对 refresh token 做哈希存储。
    - 优先使用 passlib 的 bcrypt（如果可用）
    - 否则回退到直接使用 bcrypt，避免在某些环境下 pwd_context 为 None 导致报错
    """
    token_bytes = token.encode("utf-8")

    # 如果 passlib 可用，优先使用
    if pwd_context:
        try:
            return pwd_context.hash(token)
        except Exception:
            pass

    # 回退：直接使用 bcrypt
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(token_bytes, salt)
    return hashed.decode("utf-8")


def verify_token_hash(token: str, token_hash: str) -> bool:
    """校验 token 是否匹配存储的 hash"""
    # token 通常不会超过 72 字节，但为了安全还是检查一下
    token_bytes = token.encode("utf-8")
    if len(token_bytes) > 72:
        # 如果 token 超过 72 字节，使用 SHA256 先哈希再比较
        import hashlib

        token = hashlib.sha256(token_bytes).hexdigest()
        token_bytes = token.encode("utf-8")

    # 如果 passlib 可用，优先使用
    if pwd_context:
        try:
            return pwd_context.verify(token, token_hash)
        except Exception:
            # 回退到 bcrypt
            pass

    # 回退方案：使用 bcrypt 直接校验
    try:
        return bcrypt.checkpw(token_bytes, token_hash.encode("utf-8"))
    except Exception:
        return False


def _create_jwt_token(
    *,
    subject: str,
    token_type: str,
    expires_delta: timedelta,
    jti: str,
    aud: Optional[str] = None,
) -> str:
    """
    统一创建 JWT（access/refresh 都走这里）。含 iss/aud 以支持应用间信任校验。
    """
    now = datetime.utcnow()
    payload = {
        "sub": subject,
        "token_type": token_type,
        "jti": jti,
        "iat": int(now.timestamp()),
        "exp": now + expires_delta,
        "iss": getattr(settings, "ISSUER_BASE_URL", "UnifiedAuthSystem"),
    }
    if aud is not None:
        payload["aud"] = aud
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def create_access_token(*, subject: str, jti: str, aud: Optional[str] = None) -> Tuple[str, int]:
    """
    创建 access token（短期）。aud 为受众（如 client_id），可选。
    """
    expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    token = _create_jwt_token(
        subject=subject, token_type="access", expires_delta=expires, jti=jti, aud=aud
    )
    return token, int(expires.total_seconds())


def create_refresh_token(*, subject: str, jti: str, aud: Optional[str] = None) -> Tuple[str, datetime]:
    """
    创建 refresh token（长期）。aud 为受众，可选。
    """
    expires = timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    token = _create_jwt_token(
        subject=subject, token_type="refresh", expires_delta=expires, jti=jti, aud=aud
    )
    return token, datetime.utcnow() + expires


def new_jti() -> str:
    """生成随机 jti（token 唯一标识）"""
    return secrets.token_hex(16)


def verify_token(token: str) -> dict:
    """
    验证JWT令牌（只做签名与 exp 校验，不做业务校验）
    """
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        return payload
    except jwt.JWTError:
        raise ValueError("无效的令牌")

