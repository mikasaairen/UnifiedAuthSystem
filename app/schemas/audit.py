"""
审计日志相关Schema
"""
from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel


class AuditLogBase(BaseModel):
    """
    审计日志基础模型
    """
    action: str
    resource: Optional[str] = None
    details: Optional[str] = None


class AuditLogCreate(AuditLogBase):
    """
    审计日志创建模型
    """
    actor_user_id: Optional[int] = None
    target_user_id: Optional[int] = None
    app_id: Optional[int] = None


class AuditLogResponse(BaseModel):
    """
    审计日志响应模型
    """
    id: int
    actor_user_id: Optional[int] = None
    target_user_id: Optional[int] = None
    app_id: Optional[int] = None
    action: str
    resource: Optional[str] = None
    ip: Optional[str] = None
    user_agent: Optional[str] = None
    success: bool
    details: Optional[str] = None
    created_at: datetime
    
    class Config:
        from_attributes = True


class AuditLogListResponse(BaseModel):
    """审计日志列表分页响应"""
    items: List[AuditLogResponse]
    total: int

