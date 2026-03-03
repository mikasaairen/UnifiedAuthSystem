@echo off

rem 激活虚拟环境
echo Activating virtual environment...
call ".venv\Scripts\activate.bat"

rem 启动服务器
echo Starting server...
python -c "import asyncio; asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy()); import uvicorn; uvicorn.run('app.main:app', host='0.0.0.0', port=8000, reload=True)"

rem 暂停脚本
echo Server stopped.
pause