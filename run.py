"""
启动脚本 - 统一身份认证系统
"""
import asyncio
import platform
import sys
import os

# 设置 Windows 事件循环策略（解决 Windows 平台 asyncio 问题）
if platform.system() == 'Windows':
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

# 添加项目根目录到 Python 路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

if __name__ == "__main__":
    import uvicorn
    
    print("=" * 50)
    print("统一身份认证系统启动中...")
    print("=" * 50)
    print("访问地址: http://127.0.0.1:8000/")
    print("登录页:   http://127.0.0.1:8000/login")
    print("控制台:   http://127.0.0.1:8000/dashboard")
    print("API 文档: http://127.0.0.1:8000/docs")
    print("=" * 50)
    print("按 Ctrl+C 停止服务器")
    print("=" * 50)
    
    # 启动服务器
    uvicorn.run(
        "app.main:app",
        host="127.0.0.1",
        port=8000,
        reload=True,  # 开发模式，代码修改自动重载
        log_level="info"
    )

