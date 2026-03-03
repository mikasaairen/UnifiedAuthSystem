# 激活虚拟环境
& ".venv\Scripts\Activate.ps1"

# 启动服务器
python -c "import asyncio; asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy()); import uvicorn; uvicorn.run('app.main:app', host='0.0.0.0', port=8000, reload=True)"
# 暂停脚本
Read-Host "Press Enter to exit"
