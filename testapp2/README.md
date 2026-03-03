# 测试应用 test2 - 统一认证系统外部接入示例

## 项目简介

本项目是一个基于 Flask 框架的测试应用，用于演示如何接入统一认证系统（运行在 8000 端口）。应用运行在 5001 端口，使用独立的虚拟环境。

## 接入参数

- **app_id**: ZY3oyyX94OFpFT75bL5pQw
- **app_secret**: zJXtbmKFuwlXLD-H_S2NRLhzwOwnmFbtnVT6PBDFtKg
- **app_name**: test2
- **status**: pending
- **回调地址**: http://localhost:5001/oauth/callback

## 环境要求

- Python 3.8+
- pip 包管理器

## 快速开始

### 1. 克隆项目

```bash
git clone <项目地址>
cd testapp2
```

### 2. 创建虚拟环境

```bash
# Windows
python -m venv venv

# Linux/Mac
python3 -m venv venv
```

### 3. 激活虚拟环境

```bash
# Windows
venv\Scripts\activate

# Linux/Mac
source venv/bin/activate
```

### 4. 安装依赖

```bash
pip install -r requirements.txt
```

### 5. 配置环境变量

复制 `.env.example` 文件为 `.env`，并根据实际情况修改配置：

```bash
cp .env.example .env
# 编辑 .env 文件，确保配置正确
```

### 6. 启动应用

```bash
python app.py
```

应用将在 `http://localhost:5001` 启动。

## 接入流程说明

### 1. 应用注册

在统一认证系统中注册应用，使用以下参数：

- **应用名称**: test2
- **应用ID**: ZY3oyyX94OFpFT75bL5pQw
- **应用密钥**: zJXtbmKFuwlXLD-H_S2NRLhzwOwnmFbtnVT6PBDFtKg
- **回调地址**: http://localhost:5001/oauth/callback
- **状态**: pending

### 2. 认证流程

1. 用户访问应用首页 `http://localhost:5001`
2. 应用检测到用户未登录，生成 `state` 参数并跳转到统一认证系统的授权页面
3. 用户在统一认证系统登录并授权
4. 统一认证系统回调到应用的 `http://localhost:5001/oauth/callback` 地址，携带 `code` 和 `state` 参数
5. 应用验证 `state` 参数，使用 `code` 换取 `access_token`
6. 应用使用 `access_token` 调用统一认证系统的 `/api/v1/users/me` 接口获取用户信息
7. 应用展示用户信息，完成登录流程

### 3. 退出流程

用户点击退出登录按钮，应用清除会话信息，重定向到应用首页。

## 代码结构

- `app.py`: 主应用文件，包含认证流程和路由处理
- `requirements.txt`: 依赖包配置
- `.env.example`: 环境变量示例
- `.env`: 实际环境变量配置
- `README.md`: 项目说明文档

## 注意事项

1. 确保统一认证系统运行在 `http://127.0.0.1:8000`
2. 回调地址必须与在统一认证系统中注册的完全一致
3. 应用状态为 `pending`，需要在统一认证系统中审核通过后才能正常使用
4. 生产环境中请修改 `FLASK_SECRET_KEY` 为安全的随机字符串

## 故障排查

### 常见问题

1. **回调地址不匹配**
   - 检查 `.env` 文件中的 `CALLBACK_URL` 是否与统一认证系统中注册的一致

2. **应用未审核通过**
   - 联系统一认证系统管理员审核应用状态

3. **网络连接问题**
   - 确保统一认证系统正常运行
   - 检查网络连接是否正常

4. **依赖包安装失败**
   - 确保虚拟环境激活
   - 尝试使用 `pip install --upgrade pip` 升级 pip

## 联系信息

如有问题，请联系统一认证系统管理员。