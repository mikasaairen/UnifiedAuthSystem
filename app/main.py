"""
FastAPI应用入口
初始化应用，配置CORS，挂载路由，提供模板页（登录、管理控制台）
"""
import asyncio
import os
import platform

# 设置 Windows 事件循环策略
if platform.system() == 'Windows':
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import RedirectResponse
from fastapi.templating import Jinja2Templates

from app.core.config import settings
from app.core.cors import DynamicCORSMiddleware
from app.api.v1.api import api_router

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    description="统一认证授权系统"
)

# 动态 CORS：配置中的来源 + 已审核通过应用的 callback_url 的 origin，审核通过后自动生效
app.add_middleware(DynamicCORSMiddleware)

# 挂载路由（API 优先）
app.include_router(api_router, prefix=settings.API_V1_STR)


# 项目根目录与模板、静态文件（使用绝对路径，与启动目录无关）
_here = os.path.dirname(os.path.abspath(os.path.realpath(__file__)))
_project_root = os.path.abspath(os.path.join(_here, ".."))
_templates_dir = os.path.normpath(os.path.join(_project_root, "templates"))
_static_dir = os.path.normpath(os.path.join(_project_root, "static"))
if not os.path.isdir(_templates_dir):
    raise RuntimeError("templates 目录不存在: %s" % _templates_dir)
templates = Jinja2Templates(directory=_templates_dir)

# 挂载静态资源：/static -> static/
if os.path.isdir(_static_dir):
    app.mount("/static", StaticFiles(directory=_static_dir), name="static")


@app.get("/health")
async def health_check():
    """健康检查"""
    return {"status": "ok", "version": settings.VERSION}


@app.get("/")
async def index():
    """根路径重定向到登录页"""
    return RedirectResponse(url="/login", status_code=302)


@app.get("/login")
async def login_page(request: Request):
    """登录/注册页"""
    return templates.TemplateResponse(
        "login.html",
        {"request": request},
        media_type="text/html; charset=utf-8",
    )


@app.get("/dashboard")
async def dashboard_page(request: Request):
    """管理控制台"""
    return templates.TemplateResponse(
        "dashboard.html",
        {"request": request},
        media_type="text/html; charset=utf-8",
    )
