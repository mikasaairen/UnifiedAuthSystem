# UnifiedAuthSystem - 统一身份认证与访问控制服务

一个面向 Web 应用的统一身份认证与访问控制服务平台，采用 B/S 架构，基于 Python 3.8+ 和 FastAPI 框架构建，为多个 Web 应用系统提供统一的安全服务能力。

## 项目简介

随着 Web 技术的发展，企业和组织内部往往同时运行多个 Web 应用系统。这些系统普遍存在用户身份管理分散、认证方式各自实现、权限控制策略不统一等问题，不仅增加了系统开发和运维成本，也使整体安全防护体系难以形成统一有效的控制。

本项目将身份认证与访问控制能力从具体业务系统中剥离出来，构建一个可独立部署、可被多个 Web 应用系统接入的统一安全服务平台，降低业务系统重复开发认证与授权功能的成本，提升 Web 应用整体安全防护水平。

## 功能特性

### 1. 统一身份认证服务模块
- 基于用户名和密码的认证方式
- 采用 bcrypt 加盐哈希算法实现密码安全存储与校验
- 提供标准化认证接口，集中处理多 Web 应用的认证请求
- OAuth2 Password Flow 兼容

### 2. 身份凭证与会话管理模块
- JWT（JSON Web Token）身份凭证生成与校验
- access_token（短期有效）和 refresh_token（长期有效）双令牌机制
- 令牌过期与失效控制
- 会话集中维护，支持多应用场景下认证结果安全复用
- refresh_token 哈希存储，支持会话撤销

### 3. 基于角色的访问控制（RBAC）模块
- 用户、角色、权限、资源四层映射关系
- 角色创建、权限分配、用户角色绑定
- 细粒度权限控制策略
- 支持权限的增删改查操作

### 4. 统一授权校验接口模块
- 标准化身份校验和权限判断 API
- 业务系统调用接口完成授权决策
- 权限校验逻辑与业务系统解耦

### 5. 多 Web 应用系统接入管理模块
- 应用注册与审核管理
- 为接入系统分配唯一标识（app_id）和接入凭证（app_secret）
- 系统级身份校验
- 应用状态管理（待审核/已启用/已禁用）

### 6. 账户安全控制与风险防护模块
- 登录失败次数限制（默认 5 次）
- 账户临时锁定（默认 15 分钟）
- 记录登录 IP、时间、User-Agent 等信息
- bcrypt 加盐哈希密码存储

### 7. 安全管理与审计模块
- 记录用户认证行为、授权决策结果、异常访问事件等安全日志
- 日志包含操作人、操作时间、操作内容、IP 地址等信息
- 提供日志查询接口，支持按时间范围、操作类型、用户等条件筛选
- 支持审计日志 CSV 格式导出
- 用户状态管理、角色与权限配置、安全策略维护

## 技术栈

- **后端框架**: FastAPI 0.104.1
- **ORM**: SQLAlchemy 2.0.23
- **数据验证**: Pydantic 2.5.0
- **身份认证**: JWT（python-jose）
- **密码加密**: bcrypt（passlib）
- **数据库**: 
  - SQLite（开发环境，默认）
  - MySQL 5.7+（生产环境，推荐）
- **模板引擎**: Jinja2 3.1.2
- **ASGI 服务器**: Uvicorn 0.24.0
- **前端**: 原生 HTML、CSS、JavaScript（模板 + 静态资源由 FastAPI 提供）

## 项目结构

```
UnifiedAuthSystem/
├── app/                          # 应用主目录
│   ├── __init__.py
│   ├── main.py                  # FastAPI 应用入口
│   ├── api/                     # API 路由
│   │   ├── __init__.py
│   │   ├── deps.py              # 依赖注入
│   │   ├── middleware.py        # 中间件
│   │   └── v1/                  # API v1 版本
│   │       ├── __init__.py
│   │       ├── api.py           # API 路由聚合
│   │       └── endpoints/       # 端点实现
│   │           ├── __init__.py
│   │           ├── auth.py       # 认证相关接口
│   │           ├── users.py      # 用户管理接口
│   │           ├── rbac.py       # 角色权限管理接口
│   │           ├── apps.py       # 应用接入管理接口
│   │           └── logs.py       # 审计日志接口
│   ├── core/                    # 核心配置
│   │   ├── __init__.py
│   │   ├── config.py            # 配置管理
│   │   └── security.py          # 安全相关（密码加密、JWT）
│   ├── crud/                    # 数据库操作
│   │   ├── __init__.py
│   │   ├── base.py              # 基础 CRUD
│   │   ├── crud_user.py         # 用户 CRUD
│   │   ├── crud_rbac.py         # RBAC CRUD
│   │   ├── crud_app.py          # 应用 CRUD
│   │   ├── crud_session.py      # 会话 CRUD
│   │   └── crud_audit.py        # 审计日志 CRUD
│   ├── db/                      # 数据库配置
│   │   ├── __init__.py
│   │   ├── base.py              # 数据库基类
│   │   ├── session.py           # 会话管理
│   │   └── init_db.py           # 数据库初始化
│   ├── models/                  # ORM 模型
│   │   ├── __init__.py
│   │   ├── user.py              # 用户模型
│   │   ├── rbac.py              # RBAC 模型
│   │   ├── application.py       # 应用模型
│   │   ├── session.py           # 会话模型
│   │   └── audit.py             # 审计日志模型
│   └── schemas/                 # Pydantic 模型
│       ├── __init__.py
│       ├── user.py              # 用户 Schema
│       ├── rbac.py              # RBAC Schema
│       ├── application.py       # 应用 Schema
│       ├── token.py             # 令牌 Schema
│       └── audit.py             # 审计日志 Schema
├── static/                       # 静态文件
│   ├── css/                     # 样式（如 style.css）
│   └── js/                      # 脚本（api.js、auth.js、admin/*.js 控制台分片）
├── templates/                    # HTML 模板
│   ├── login.html               # 登录/注册页
│   └── dashboard.html           # 管理控制台
├── requirements.txt              # Python 依赖
├── .env                         # 环境配置
├── run.py                       # 启动脚本
└── README.md                    # 项目文档
```

## 快速开始

### 环境要求

- Python 3.8+
- MySQL 5.7+（生产环境推荐）或 SQLite（开发环境）
- 操作系统：Windows、Linux、macOS

### 安装步骤

1. **克隆项目**

```bash
git clone <repository-url>
cd UnifiedAuthSystem
```

2. **创建虚拟环境**

```bash
# Windows
python -m venv .venv

# Linux/macOS
python3 -m venv .venv
```

3. **激活虚拟环境**

```bash
# Windows
.venv\Scripts\activate

# Linux/macOS
source .venv/bin/activate
```

4. **安装依赖**

```bash
pip install -r requirements.txt
```

5. **配置环境变量**

复制并编辑 `.env` 文件：

```bash
# 配置已在项目根目录提供，根据需要修改
```

主要配置项说明：

```env
# 项目配置
PROJECT_NAME=UnifiedAuthSystem
VERSION=1.0.0
API_V1_STR=/api/v1

# 安全配置（JWT）
SECRET_KEY=your-secret-key-change-in-production  # 生产环境请修改
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30
REFRESH_TOKEN_EXPIRE_DAYS=7

# 数据库配置
# SQLite（开发环境，默认）
DATABASE_URL=sqlite:///./unified_auth.db

# MySQL（生产环境，取消注释并配置）
# DATABASE_URL=mysql+pymysql://root:password@127.0.0.1:3306/unified_auth?charset=utf8mb4

# CORS配置
BACKEND_CORS_ORIGINS=["http://localhost:8000", "http://localhost:3000", "http://localhost:5000"]

# 账户风控策略
LOGIN_MAX_FAILS=5
LOGIN_LOCK_MINUTES=15

# 超级管理员配置
FIRST_SUPERUSER_USERNAME=admin
FIRST_SUPERUSER_EMAIL=admin@example.com
FIRST_SUPERUSER_PASSWORD=admin123
```

6. **数据库初始化**

首次运行前需要初始化数据库，创建表结构和默认管理员用户：

```bash
python -c "from app.db.init_db import init_db; from app.db.session import SessionLocal; db = SessionLocal(); init_db(db); db.close()"
```

初始化后会创建：
- 超级管理员用户：用户名 `admin`，密码 `admin123`
- 默认角色：admin（系统管理员）、operator（操作员）、user（普通用户）

7. **启动应用**

```bash
python run.py
```

或使用 uvicorn 直接启动：

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

应用将在 `http://localhost:8000` 启动。

## 访问地址

启动应用后，可以访问以下地址：

- **应用首页**: `http://localhost:8000/`（重定向到登录页）
- **登录/注册**: `http://localhost:8000/login`
- **管理控制台**: `http://localhost:8000/dashboard`（需先登录）
- **Swagger UI（API 文档）**: `http://localhost:8000/docs`
- **ReDoc（API 文档）**: `http://localhost:8000/redoc`
- **健康检查**: `http://localhost:8000/health`

## 默认账号

系统初始化后会创建一个超级管理员账号：

- 用户名：`admin`
- 密码：`admin123`
- 邮箱：`admin@example.com`

**重要提示**：首次登录后请立即修改默认密码！

## API 使用示例

### 用户登录

```bash
curl -X POST "http://localhost:8000/api/v1/auth/login" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=admin&password=admin123"
```

响应：
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "bearer",
  "expires_in": 1800
}
```

### 获取当前用户信息

```bash
curl -X GET "http://localhost:8000/api/v1/users/me" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

### 刷新访问令牌

```bash
curl -X POST "http://localhost:8000/api/v1/auth/refresh" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "refresh_token=YOUR_REFRESH_TOKEN"
```

### 注册新应用（管理员）

```bash
curl -X POST "http://localhost:8000/api/v1/apps/register" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "app_name": "我的应用",
    "description": "这是一个测试应用",
    "callback_url": "http://localhost:3000/callback"
  }'
```

### 检查用户权限

```bash
curl -X POST "http://localhost:8000/api/v1/apps/check-permission?app_id=myapp&permission_code=read" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

### 查询审计日志（管理员）

```bash
curl -X GET "http://localhost:8000/api/v1/logs/?limit=100" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

## 数据库配置

### SQLite 配置（开发环境）

SQLite 是默认的数据库配置，无需额外安装，启动应用时会自动创建数据库文件。

配置：
```env
DATABASE_URL=sqlite:///./unified_auth.db
```

### MySQL 配置（生产环境）

1. **安装 MySQL**

   - Windows: 下载 MySQL Installer 并安装
   - Linux: `sudo apt install mysql-server`
   - macOS: 使用 Homebrew `brew install mysql`

2. **创建数据库和用户**

```sql
-- 创建数据库
CREATE DATABASE unified_auth CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 创建用户
CREATE USER 'authuser'@'localhost' IDENTIFIED BY 'your-strong-password';

-- 授权
GRANT ALL PRIVILEGES ON unified_auth.* TO 'authuser'@'localhost';

-- 刷新权限
FLUSH PRIVILEGES;
```

3. **更新 .env 配置**

```env
DATABASE_URL=mysql+pymysql://authuser:your-strong-password@localhost:3306/unified_auth?charset=utf8mb4
```

## 部署指南

### 使用 Docker 部署

1. **创建 Dockerfile**

```dockerfile
FROM python:3.9-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["python", "run.py"]
```

2. **创建 docker-compose.yml**

```yaml
version: '3.8'

services:
  app:
    build: .
    ports:
      - "8000:8000"
    environment:
      - SECRET_KEY=your-secret-key-change-in-production
      - DATABASE_URL=mysql+pymysql://root:password@db:3306/unified_auth
      - FIRST_SUPERUSER_USERNAME=admin
      - FIRST_SUPERUSER_PASSWORD=admin123
    depends_on:
      - db

  db:
    image: mysql:5.7
    environment:
      - MYSQL_ROOT_PASSWORD=password
      - MYSQL_DATABASE=unified_auth
    volumes:
      - mysql_data:/var/lib/mysql

volumes:
  mysql_data:
```

3. **启动服务**

```bash
docker-compose up -d
```

### 使用 Nginx + Gunicorn + Supervisor 部署（Linux）

详见旧版 README.md 中的服务器搭建指南。

## 开发说明

### 代码风格

- 遵循 PEP 8 规范
- 使用类型提示（Type Hints）

### 添加新功能

1. 在 `app/models/` 中添加新的 ORM 模型
2. 在 `app/schemas/` 中添加新的数据验证模型
3. 在 `app/crud/` 中添加新的数据库操作
4. 在 `app/api/v1/endpoints/` 中添加新的路由
5. 在 `app/api/v1/api.py` 中注册新路由

### 数据库迁移

当前使用 SQLAlchemy 的自动创建功能，生产环境建议使用 Alembic 进行数据库迁移。

## 安全建议

1. **修改默认密钥**：生产环境务必修改 `SECRET_KEY`
2. **使用 HTTPS**：生产环境部署时务必使用 HTTPS
3. **定期更新依赖**：定期更新 Python 依赖包，修复安全漏洞
4. **配置防火墙**：限制数据库等服务的访问权限
5. **日志监控**：定期检查审计日志，发现异常行为及时处理
6. **备份数据**：定期备份数据库数据

## 故障排除

### 常见问题

1. **数据库连接失败**
   - 检查数据库服务是否启动
   - 检查数据库连接字符串是否正确
   - 检查数据库用户权限是否正确

2. **依赖安装失败**
   - 确保 Python 版本 >= 3.8
   - 尝试使用 `pip install --upgrade pip` 升级 pip

3. **端口被占用**
   - 检查 8000 端口是否被其他进程占用
   - Windows: `netstat -ano | findstr :8000`
   - Linux/macOS: `lsof -i :8000`

4. **JWT 令牌验证失败**
   - 检查 `SECRET_KEY` 是否正确配置
   - 检查令牌是否过期

## 许可证

MIT License

## 联系方式

如有问题或建议，请联系项目维护者。

## 致谢

感谢所有为本项目做出贡献的开发者。
