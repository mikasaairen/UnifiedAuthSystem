"""
中间件：应用系统级身份校验
"""
from fastapi import Request, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.crud import crud_app


class AppAuthMiddleware(BaseHTTPMiddleware):
    """
    应用系统级身份校验中间件
    
    对于需要应用身份验证的接口（如授权校验接口），
    需要同时提供 app_id 和 app_secret 进行系统级身份校验
    """
    
    async def dispatch(self, request: Request, call_next):
        # 需要应用身份验证的路径
        protected_paths = [
            "/api/v1/apps/check-permission",
        ]
        
        # 检查是否需要应用身份验证
        needs_app_auth = any(request.url.path.startswith(path) for path in protected_paths)
        
        if needs_app_auth:
            # 从 Header 或 Query 参数获取 app_id 和 app_secret
            app_id = request.headers.get("X-App-Id") or request.query_params.get("app_id")
            app_secret = request.headers.get("X-App-Secret") or request.query_params.get("app_secret")
            
            if not app_id or not app_secret:
                return Response(
                    content='{"detail": "缺少应用身份凭证（app_id 和 app_secret）"}',
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    media_type="application/json"
                )
            
            # 验证应用身份
            db = SessionLocal()
            try:
                is_valid = crud_app.verify_app_secret(
                    db, app_id=app_id, app_secret=app_secret
                )
                if not is_valid:
                    return Response(
                        content='{"detail": "应用身份验证失败"}',
                        status_code=status.HTTP_401_UNAUTHORIZED,
                        media_type="application/json"
                    )
                # 将 app_id 添加到 request.state 供后续使用
                request.state.app_id = app_id
            finally:
                db.close()
        
        response = await call_next(request)
        return response
