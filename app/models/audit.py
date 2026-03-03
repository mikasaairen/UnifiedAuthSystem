"""
审计日志表
"""
from sqlalchemy import Boolean, Column, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.sql import func
from app.db.base import Base


class AuditLog(Base):
    """
    审计日志表
    """
    __tablename__ = "audit_logs"
    
    id = Column(Integer, primary_key=True, index=True)
    # 操作人（可能为空：系统事件）
    actor_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    # 目标用户（例如管理员禁用用户）
    target_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)

    app_id = Column(Integer, ForeignKey("applications.id"), nullable=True, index=True)
    action = Column(String(64), nullable=False, index=True)  # login/logout/refresh/check_permission/...
    resource = Column(String(255), nullable=True)
    ip = Column(String(64), nullable=True)
    user_agent = Column(String(255), nullable=True)
    success = Column(Boolean, nullable=False, default=True)

    # 为了尽量兼容不同数据库，这里用 Text 存 JSON 字符串（MySQL 可用 JSON 类型的建表脚本）
    details = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)

