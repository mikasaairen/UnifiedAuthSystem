"""
用户、角色、权限关联
"""
from sqlalchemy import Boolean, Column, DateTime, Integer, String
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.base import Base


class User(Base):
    """
    用户表
    """
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    full_name = Column(String, nullable=True)
    is_active = Column(Boolean, default=True)
    is_admin = Column(Boolean, default=False)

    # 账户风控字段
    failed_login_attempts = Column(Integer, nullable=False, default=0)
    locked_until = Column(DateTime(timezone=False), nullable=True)
    last_login_at = Column(DateTime(timezone=False), nullable=True)
    last_login_ip = Column(String(64), nullable=True)
    last_user_agent = Column(String(255), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    
    # 关联关系
    # RBAC：用户-角色（多对多），关联表定义在 app/models/rbac.py
    roles = relationship("Role", secondary="user_roles", back_populates="users", lazy="selectin")

    # 会话（refresh token 存储）
    sessions = relationship("Session", back_populates="user")

