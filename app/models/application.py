"""
接入应用表
"""
from sqlalchemy import Boolean, Column, Integer, String, Text
from sqlalchemy.orm import relationship
from app.db.base import Base


class Application(Base):
    """
    第三方应用表
    """
    __tablename__ = "applications"
    
    id = Column(Integer, primary_key=True, index=True)
    app_id = Column(String, unique=True, index=True, nullable=False)  # 应用唯一标识
    app_name = Column(String, nullable=False)  # 应用名称
    description = Column(Text, nullable=True)  # 应用描述
    # 注意：不要明文存 app_secret，务必存 hash
    app_secret_hash = Column(String, nullable=False)

    # 审核与状态管理：pending / active / disabled
    status = Column(String, nullable=False, default="pending")
    callback_url = Column(String, nullable=True)

    # 兼容旧字段：保留 is_active 供旧逻辑使用（等接口重构完可移除）
    is_active = Column(Boolean, default=True)
    
    # 关联关系（RBAC/会话/资源）
    resources = relationship("Resource", back_populates="app", cascade="all, delete-orphan")
    sessions = relationship("Session", back_populates="app")

