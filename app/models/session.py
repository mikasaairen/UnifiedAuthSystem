"""
会话表（用于 refresh token 失效/撤销）

设计思路：
- access token 只短期有效（不落库）
- refresh token 长期有效（只存 hash），可在登出/风控时撤销
"""

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.base import Base


class Session(Base):
    __tablename__ = "sessions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    app_id = Column(Integer, ForeignKey("applications.id"), nullable=True, index=True)

    # JWT jti：用于唯一标识一次 refresh 会话
    jti = Column(String(64), unique=True, index=True, nullable=False)

    # refresh token 只存 hash，防止数据库泄露导致 token 可用
    refresh_token_hash = Column(String(255), nullable=False)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    expires_at = Column(DateTime(timezone=False), nullable=False, index=True)
    revoked_at = Column(DateTime(timezone=False), nullable=True)

    ip = Column(String(64), nullable=True)
    user_agent = Column(String(255), nullable=True)

    user = relationship("User", back_populates="sessions")
    app = relationship("Application", back_populates="sessions")

