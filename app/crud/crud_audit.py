"""
审计日志CRUD
"""
from datetime import datetime
from typing import Optional, List, Dict
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.crud.base import CRUDBase
from app.models.audit import AuditLog


class CRUDAudit(CRUDBase[AuditLog, None, None]):
    def create_log(
        self,
        db: Session,
        *,
        actor_user_id: Optional[int],
        action: str,
        app_id: Optional[int] = None,
        target_user_id: Optional[int] = None,
        resource: Optional[str] = None,
        ip: Optional[str] = None,
        user_agent: Optional[str] = None,
        success: bool = True,
        details: Optional[str] = None,
    ) -> AuditLog:
        """
        创建审计日志（统一入口）

        - actor_user_id：操作人（可为空：系统事件）
        - target_user_id：被影响用户（可选）
        - details：建议存 JSON 字符串，便于后续检索/导出
        """
        db_obj = AuditLog(
            actor_user_id=actor_user_id,
            target_user_id=target_user_id,
            app_id=app_id,
            action=action,
            resource=resource,
            ip=ip,
            user_agent=user_agent,
            success=success,
            details=details,
            created_at=datetime.utcnow(),
        )
        db.add(db_obj)
        db.commit()
        db.refresh(db_obj)
        return db_obj
    
    def get_logs(
        self,
        db: Session,
        *,
        skip: int = 0,
        limit: int = 100,
        user_id: Optional[int] = None,
        app_id: Optional[int] = None,
        action: Optional[str] = None,
        success: Optional[bool] = None,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None
    ) -> List[AuditLog]:
        """
        查询审计日志
        """
        query = db.query(AuditLog)
        if user_id:
            query = query.filter(AuditLog.actor_user_id == user_id)
        if app_id:
            query = query.filter(AuditLog.app_id == app_id)
        if action:
            query = query.filter(AuditLog.action == action)
        if success is not None:
            query = query.filter(AuditLog.success == success)
        if start_time:
            query = query.filter(AuditLog.created_at >= start_time)
        if end_time:
            query = query.filter(AuditLog.created_at <= end_time)
        return query.order_by(AuditLog.created_at.desc()).offset(skip).limit(limit).all()

    def get_logs_count(
        self,
        db: Session,
        *,
        user_id: Optional[int] = None,
        app_id: Optional[int] = None,
        action: Optional[str] = None,
        success: Optional[bool] = None,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None
    ) -> int:
        """与 get_logs 相同筛选条件下的总数"""
        query = db.query(AuditLog)
        if user_id:
            query = query.filter(AuditLog.actor_user_id == user_id)
        if app_id:
            query = query.filter(AuditLog.app_id == app_id)
        if action:
            query = query.filter(AuditLog.action == action)
        if success is not None:
            query = query.filter(AuditLog.success == success)
        if start_time:
            query = query.filter(AuditLog.created_at >= start_time)
        if end_time:
            query = query.filter(AuditLog.created_at <= end_time)
        return query.count()
    
    def get_stats(
        self,
        db: Session,
        *,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None
    ) -> Dict:
        """
        获取日志统计信息
        """
        query = db.query(AuditLog)
        
        if start_time:
            query = query.filter(AuditLog.created_at >= start_time)
        if end_time:
            query = query.filter(AuditLog.created_at <= end_time)
        
        total = query.count()
        action_stats = db.query(
            AuditLog.action,
            func.count(AuditLog.id).label('count')
        ).group_by(AuditLog.action).all()
        
        return {
            "total": total,
            "action_stats": {action: count for action, count in action_stats}
        }


crud_audit = CRUDAudit(AuditLog)

