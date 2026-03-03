"""
动态 CORS：在配置的允许源基础上，自动加入已审核通过应用的 callback_url 的 origin，
实现注册并审核成功后无需手动配置 CORS。
"""
import time
from typing import List, Tuple
from urllib.parse import urlparse

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.core.config import settings

# 缓存： (origins_list, 过期时间戳)
_cors_cache: Tuple[List[str], float] = ([], 0.0)
_CORS_CACHE_SECONDS = 60


def get_allowed_origins() -> List[str]:
    """
    返回当前允许的 CORS 源 = 配置中的 BACKEND_CORS_ORIGINS + 所有 status=active 应用的 callback_url 的 origin。
    结果缓存 60 秒，减少数据库查询。
    """
    global _cors_cache
    now = time.time()
    if _cors_cache[1] > now:
        return _cors_cache[0]

    base = list(settings.BACKEND_CORS_ORIGINS) if isinstance(settings.BACKEND_CORS_ORIGINS, list) else []
    try:
        from app.db.session import SessionLocal
        from app.models.application import Application

        db = SessionLocal()
        try:
            apps = db.query(Application).filter(
                Application.status == "active",
                Application.callback_url.isnot(None),
                Application.callback_url != "",
            ).all()
            seen = set(base)
            for app in apps:
                if not app.callback_url:
                    continue
                try:
                    parsed = urlparse(app.callback_url)
                    if parsed.scheme and parsed.netloc:
                        origin = f"{parsed.scheme}://{parsed.netloc}"
                        if origin not in seen:
                            seen.add(origin)
                            base.append(origin)
                except Exception:
                    continue
        finally:
            db.close()
    except Exception:
        pass

    _cors_cache = (base, now + _CORS_CACHE_SECONDS)
    return base


def invalidate_cors_cache() -> None:
    """审核通过/编辑应用回调地址后调用，使下次请求时重新拉取 CORS 列表。"""
    global _cors_cache
    _cors_cache = ([], 0.0)


class DynamicCORSMiddleware(BaseHTTPMiddleware):
    """动态 CORS 中间件：允许来源 = 配置 + 已启用应用的回调地址 origin。"""

    async def dispatch(self, request: Request, call_next) -> Response:
        origins = get_allowed_origins()
        origin = request.headers.get("origin")

        def add_cors_headers(response: Response) -> None:
            if origin and origin in origins:
                response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Credentials"] = "true"
            response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
            response.headers["Access-Control-Allow-Headers"] = "*"
            response.headers["Access-Control-Expose-Headers"] = "*"

        if request.method == "OPTIONS":
            response = Response(status_code=200)
            add_cors_headers(response)
            return response

        response = await call_next(request)
        add_cors_headers(response)
        return response
