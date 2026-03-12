"""
系统设置接口：查询/修改运行时配置
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.api.deps import get_db, require_permission
from app.core.config import settings
from app.core.token_blacklist import blacklist_size, cleanup_expired
from app.models.user import User

router = APIRouter()


class SystemSettingsResponse(BaseModel):
    require_registration_approval: bool


class SystemSettingsUpdate(BaseModel):
    require_registration_approval: bool | None = None


@router.get("/settings", response_model=SystemSettingsResponse)
async def get_settings(
    current_user: User = Depends(require_permission("system:manage")),
):
    return SystemSettingsResponse(
        require_registration_approval=settings.REQUIRE_REGISTRATION_APPROVAL,
    )


@router.put("/settings", response_model=SystemSettingsResponse)
async def update_settings(
    body: SystemSettingsUpdate,
    current_user: User = Depends(require_permission("system:manage")),
):
    if body.require_registration_approval is not None:
        settings.REQUIRE_REGISTRATION_APPROVAL = body.require_registration_approval
    return SystemSettingsResponse(
        require_registration_approval=settings.REQUIRE_REGISTRATION_APPROVAL,
    )


class SecurityOverview(BaseModel):
    token_blacklist_size: int
    locked_accounts: int
    pending_users: int
    recent_alerts: int


@router.get("/security-overview", response_model=SecurityOverview)
async def get_security_overview(
    current_user: User = Depends(require_permission("system:manage")),
    db: Session = Depends(get_db),
):
    """安全概览：黑名单大小、锁定账户数、待审核用户数、近期安全告警数"""
    from datetime import datetime, timedelta
    from sqlalchemy import func
    from app.models.audit import AuditLog

    cleanup_expired()
    locked = db.query(User).filter(User.locked_until > datetime.utcnow()).count()
    pending = db.query(User).filter(User.is_active == False).count()  # noqa: E712
    week_ago = datetime.utcnow() - timedelta(days=7)
    alerts = db.query(func.count(AuditLog.id)).filter(
        AuditLog.action.in_(["security_alert", "account_locked", "login_lock"]),
        AuditLog.created_at >= week_ago,
    ).scalar() or 0

    return SecurityOverview(
        token_blacklist_size=blacklist_size(),
        locked_accounts=locked,
        pending_users=pending,
        recent_alerts=alerts,
    )
