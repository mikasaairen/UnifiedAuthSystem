# 测试应用 test1（外部接入示例）

本应用为**统一认证系统**的外部接入测试应用，使用独立虚拟环境，可单独运行在 **5000** 端口，通过 OAuth2 授权码模式与认证中心完成登录。

---

## 回调地址（在认证中心配置）

在统一认证系统的**管理后台 → 应用管理**中，为应用 **test1** 配置以下回调地址并**审核通过**后，本应用才能完成「用 code 换 token」：

```
http://localhost:5000/oauth/callback
```

若使用 `127.0.0.1` 访问本应用，则需在认证中心配置为：

```
http://127.0.0.1:5000/oauth/callback
```

**注意**：`redirect_uri` 必须与认证中心里保存的回调地址**完全一致**（协议、主机、端口、路径），否则换 token 会失败。

---

## 应用运行指南

### 1. 进入目录并创建虚拟环境

```bash
cd testapp1
python -m venv venv
```

### 2. 激活虚拟环境

- Windows: `venv\Scripts\activate`
- Linux/macOS: `source venv/bin/activate`

### 3. 安装依赖

```bash
pip install -r requirements.txt
```

### 4. 配置环境变量（可选）

复制示例并按需修改：

```bash
copy .env.example .env   # Windows
# 或
cp .env.example .env    # Linux/macOS
```

编辑 `.env` 后，可用 `pip install python-dotenv` 并在 `app.py` 开头加载；当前版本也可直接设置系统环境变量或使用默认值。

### 5. 启动应用（5000 端口）

```bash
python app.py
```

浏览器访问：**http://localhost:5000**

- 未登录会跳转到认证中心登录，登录成功后回到本应用并显示用户信息。
- 「退出登录」会清除本应用会话，再次访问将重新走授权流程。

### 6. 前置条件

- 统一认证系统已启动（如 `python run.py`，默认 8000 端口）。
- 在认证中心为该应用配置好上述**回调地址**并将应用**审核通过**（status=active）。

---

## 接入指南（外部应用接入统一认证）

从「外部应用」视角，接入统一认证系统需要完成以下步骤。

### 1. 在认证中心注册应用

在管理后台创建应用，获得 `app_id`、`app_secret`，并填写**回调地址**（如 `http://localhost:5000/oauth/callback`）。回调地址必须是该应用实际接收授权码的完整 URL。

### 2. 配置应用侧参数

- **认证中心地址**：如 `http://127.0.0.1:8000`
- **app_id / app_secret**：仅在后端使用，不要暴露到前端或公开仓库
- **回调地址**：与认证中心中为该应用配置的完全一致

### 3. 授权码流程

1. **引导用户授权**  
   未登录时重定向用户到：
   ```
   GET {认证中心}/api/v1/auth/authorize?client_id={app_id}&redirect_uri={回调地址}&response_type=code&state={随机 state}
   ```
   建议用 session 或 cookie 保存 `state`，回调时校验防 CSRF。

2. **接收回调**  
   用户登录成功后，认证中心会重定向到：
   ```
   {回调地址}?code={授权码}&state={你传入的 state}
   ```
   校验 `state` 后，用 `code` 在后端换 token。

3. **用 code 换 token**  
   应用**后端**请求：
   ```
   POST {认证中心}/api/v1/auth/token
   Content-Type: application/x-www-form-urlencoded

   grant_type=authorization_code&code={code}&client_id={app_id}&client_secret={app_secret}&redirect_uri={回调地址}
   ```
   返回体中包含 `access_token`、`refresh_token` 等，将 `access_token` 存入 session 或下发前端（按安全策略）。

4. **调用受保护接口**  
   请求认证中心或其它受保护 API 时，在 Header 中携带：
   ```
   Authorization: Bearer {access_token}
   ```
   例如获取当前用户：`GET {认证中心}/api/v1/users/me`。

### 4. 注意事项

- 应用需先被**审核通过**并保存好回调地址，否则 `/token` 会拒绝换 token。
- `redirect_uri` 与认证中心配置必须一致；若使用 `localhost` 与 `127.0.0.1` 不同，需在认证中心配置对应地址。
- 生产环境请使用 HTTPS 并妥善保管 `app_secret`，使用环境变量或配置中心，不要写死在代码库中。

---

## 本应用注册信息（参考）

| 项 | 值 |
|----|-----|
| app_id | OBciOp8WXoPqh_YOaM4f7A |
| app_secret | （见 .env.example，勿提交到仓库） |
| app_name | test1 |
| 回调地址 | **http://localhost:5000/oauth/callback** |
| 运行端口 | 5000 |

在认证中心将应用 **test1** 的回调地址设为上述地址并审核通过后即可联调。
