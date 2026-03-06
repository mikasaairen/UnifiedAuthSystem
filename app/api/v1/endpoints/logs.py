"""
审计日志查询和导出 (管理员专用)
"""
from datetime import datetime, timezone, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
import csv
import io
import re

from app.api.deps import get_db, require_permission
from app.crud import crud_audit
from app.models.user import User
from app.schemas.audit import AuditLogResponse

router = APIRouter()

# 前端 datetime-local 为本地时间（北京时间），转为 UTC 再与 DB 比较
BEIJING = timezone(timedelta(hours=8))


def _parse_time_param(s: Optional[str]):
    """解析前端传来的时间字符串（视为北京时间），支持 YYYY-MM-DD 或 YYYY-MM-DDTHH:mm"""
    if not s or not isinstance(s, str) or not s.strip():
        return None
    s = s.strip()
    try:
        if len(s) == 10 and re.match(r"\d{4}-\d{2}-\d{2}", s):
            dt = datetime.strptime(s, "%Y-%m-%d")
        elif "T" in s:
            if len(s) <= 16:
                dt = datetime.strptime(s[:16], "%Y-%m-%dT%H:%M")
            else:
                dt = datetime.fromisoformat(s.replace("Z", "+00:00").replace("+00:00", ""))
                if dt.tzinfo:
                    dt = dt.replace(tzinfo=None)
        else:
            dt = datetime.strptime(s[:19], "%Y-%m-%d %H:%M:%S")
        # 视为北京时间，转为 UTC（naive）便于与 DB 比较
        dt_beijing = dt.replace(tzinfo=BEIJING)
        dt_utc = dt_beijing.astimezone(timezone.utc).replace(tzinfo=None)
        return dt_utc
    except Exception:
        return None


def _parse_end_time(s: Optional[str]):
    """结束时间：若只有日期则取当日 23:59:59（北京时间），再转 UTC"""
    dt = _parse_time_param(s)
    if dt is None:
        return None
    raw = (s or "").strip()
    if len(raw) == 10:
        # 只选了日期：当天 23:59:59 北京时间
        d = datetime.strptime(raw, "%Y-%m-%d").date()
        end_local = datetime.combine(d, datetime.max.time().replace(microsecond=999999))
        end_beijing = end_local.replace(tzinfo=BEIJING)
        return end_beijing.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


@router.get("/", response_model=list[AuditLogResponse])
async def get_audit_logs(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    user_id: Optional[int] = Query(None),
    app_id: Optional[int] = Query(None),
    action: Optional[str] = Query(None),
    success: Optional[bool] = Query(None, description="按结果筛选：true 成功 / false 失败"),
    start_time: Optional[str] = Query(None, description="开始时间 YYYY-MM-DD 或 YYYY-MM-DDTHH:mm"),
    end_time: Optional[str] = Query(None, description="结束时间 YYYY-MM-DD 或 YYYY-MM-DDTHH:mm"),
    current_user: User = Depends(require_permission("logs:view")),
    db: Session = Depends(get_db)
):
    """
    查询审计日志（管理员专用）
    """
    start_dt = _parse_time_param(start_time)
    end_dt = _parse_end_time(end_time)
    success_val = None
    if success is not None:
        success_val = success
    logs = crud_audit.get_logs(
        db,
        skip=skip,
        limit=limit,
        user_id=user_id,
        app_id=app_id,
        action=action,
        success=success_val,
        start_time=start_dt,
        end_time=end_dt
    )
    return logs


@router.get("/stats")
async def get_log_stats(
    start_time: Optional[str] = Query(None),
    end_time: Optional[str] = Query(None),
    current_user: User = Depends(require_permission("logs:view")),
    db: Session = Depends(get_db)
):
    """
    获取日志统计信息（管理员专用）
    """
    start_dt = _parse_time_param(start_time)
    end_dt = _parse_end_time(end_time)
    stats = crud_audit.get_stats(
        db,
        start_time=start_dt,
        end_time=end_dt
    )
    return stats


@router.get("/export")
async def export_audit_logs(
    user_id: Optional[int] = Query(None),
    app_id: Optional[int] = Query(None),
    action: Optional[str] = Query(None),
    success: Optional[bool] = Query(None),
    start_time: Optional[str] = Query(None),
    end_time: Optional[str] = Query(None),
    current_user: User = Depends(require_permission("logs:view")),
    db: Session = Depends(get_db)
):
    """
    导出审计日志为 CSV 格式（UTF-8 带 BOM，便于 Excel 打开）
    """
    start_dt = _parse_time_param(start_time)
    end_dt = _parse_end_time(end_time)
    logs = crud_audit.get_logs(
        db,
        skip=0,
        limit=10000,
        user_id=user_id,
        app_id=app_id,
        action=action,
        success=success if success is not None else None,
        start_time=start_dt,
        end_time=end_dt
    )
    output = io.StringIO()
    output.write("\ufeff")
    writer = csv.writer(output)
    writer.writerow([
        "ID", "操作人ID", "目标用户ID", "应用ID", "操作类型", "操作类型说明",
        "资源", "IP地址", "User-Agent", "成功", "详情", "创建时间"
    ])
    action_labels = {
        "login": "登录", "logout": "登出", "refresh": "刷新令牌",
        "user_register": "用户注册", "user_update": "用户更新", "user_disable": "用户禁用",
        "user_enable": "用户启用", "user_delete": "用户删除",
        "app_register": "应用注册", "app_delete": "应用删除", "app_approve": "应用审核",
        "check_permission": "权限检查", "introspect": "令牌内省"
    }
    for log in logs:
        writer.writerow([
            log.id,
            log.actor_user_id or "",
            log.target_user_id or "",
            log.app_id or "",
            log.action,
            action_labels.get(log.action, log.action),
            log.resource or "",
            log.ip or "",
            (log.user_agent or "")[:80],
            "是" if log.success else "否",
            log.details or "",
            log.created_at.strftime("%Y-%m-%d %H:%M:%S") if log.created_at else ""
        ])
    output.seek(0)
    filename = f"audit_logs_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )
