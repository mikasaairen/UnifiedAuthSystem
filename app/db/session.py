"""
数据库连接池
"""
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.core.config import settings

engine = create_engine(
    settings.DATABASE_URL,
    # sqlite 需要该参数；MySQL/PostgreSQL 不需要
    connect_args={"check_same_thread": False} if settings.DATABASE_URL.startswith("sqlite") else {},
    pool_pre_ping=True,  # 避免 MySQL 连接断开导致的错误
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

