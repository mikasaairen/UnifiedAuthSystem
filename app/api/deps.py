"""
核心依赖：数据库Session获取、当前用户提取
"""
from typing import Generator, Optional
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from jose import JWTError

from app.core.config import settings
from app.core.security import verify_token
from app.db.session import SessionLocal
from app.crud import crud_user
from app.models.user import User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl=f"{settings.API_V1_STR}/auth/login")

# SSO Cookie 名，与 auth 端点中设置的一致
SSO_COOKIE_NAME = "sso_token"


def get_db() -> Generator:
    """
    获取数据库Session
    """
    try:
        db = SessionLocal()
        yield db
    finally:
        db.close()


async def get_current_user_from_cookie_or_bearer(
    request: Request,
    db: Session = Depends(get_db),
) -> Optional[User]:
    """
    单点登录：优先从 Cookie 读取 sso_token，否则从 Authorization Bearer 读取。
    用于 /authorize 等需要“已登录则直接放行”的场景；失败时返回 None 而非 401。
    """
    token: Optional[str] = request.cookies.get(SSO_COOKIE_NAME)
    if not token:
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.lower().startswith("bearer "):
            token = auth_header[7:].strip()
    if not token:
        return None
    try:
        payload = verify_token(token)
        username: str = payload.get("sub")
        if not username:
            return None
        user = crud_user.get_by_username(db, username=username)
        if user is None or not user.is_active:
            return None
        return user
    except (JWTError, ValueError):
        return None


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db)
) -> User:
    """
    从JWT token中提取当前用户
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="无法验证凭据",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    try:
        payload = verify_token(token)
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except (JWTError, ValueError):
        # ValueError: verify_token 在令牌无效/过期时抛出
        raise credentials_exception
    
    user = crud_user.get_by_username(db, username=username)
    if user is None:
        raise credentials_exception
    
    return user


async def get_current_active_user(
    current_user: User = Depends(get_current_user)
) -> User:
    """
    获取当前活跃用户（已激活）
    """
    if not current_user.is_active:
        raise HTTPException(status_code=400, detail="用户未激活")
    return current_user


def require_permission(permission_code: str):
    """
    细粒度访问控制：要求当前用户拥有指定权限（仅通过角色-权限-资源映射）。
    """

    async def _dependency(
        current_user: User = Depends(get_current_active_user),
        db: Session = Depends(get_db),
    ) -> User:
        from app.crud.crud_rbac import crud_role
        if not crud_role.check_user_permission(
            db, user_id=current_user.id, permission_code=permission_code
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"权限不足，需要权限：{permission_code}",
            )
        return current_user

    return _dependency

