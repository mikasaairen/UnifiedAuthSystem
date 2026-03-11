"""
全局 API 限流器（基于 slowapi）
集中创建单例，避免每个端点模块重复实例化导致的 .env 编码问题。
"""
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address, storage_uri="memory://")
