"""
路由汇总
"""
from fastapi import APIRouter

from app.api.v1.endpoints import auth, users, apps, logs, rbac

api_router = APIRouter()

api_router.include_router(auth.router, prefix="/auth", tags=["认证"])
api_router.include_router(users.router, prefix="/users", tags=["用户"])
api_router.include_router(apps.router, prefix="/apps", tags=["应用"])
api_router.include_router(logs.router, prefix="/logs", tags=["日志"])
api_router.include_router(rbac.router, prefix="/rbac", tags=["RBAC管理"])

