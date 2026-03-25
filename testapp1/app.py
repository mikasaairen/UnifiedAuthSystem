"""
测试应用 test1 - 统一认证系统外部接入示例
运行在 5000 端口，使用独立虚拟环境。
"""
import base64
import hmac
import hashlib
import os
import secrets
import urllib.parse
from typing import Optional

from flask import Flask, redirect, request, session
import requests

app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET_KEY", "testapp1-dev-secret-change-in-prod")
app.config["SESSION_COOKIE_NAME"] = "testapp1_session"

# 从环境变量读取，未设置则使用下方默认值（与 .env.example 一致）
AUTH_CENTER_URL = os.environ.get("AUTH_CENTER_URL", "http://127.0.0.1:8000").rstrip("/")
APP_ID = os.environ.get("APP_ID", "OBciOp8WXoPqh_YOaM4f7A")
APP_SECRET = os.environ.get("APP_SECRET", "NTsjFQqwXBjZxR-YW7L_Fuer1ttF4B8VWvQCBGu-YeQ")
# 本应用运行在 5000 端口，回调地址必须与在认证中心注册的完全一致
CALLBACK_URL = os.environ.get("CALLBACK_URL", "http://localhost:5000/oauth/callback")
API_V1 = f"{AUTH_CENTER_URL}/api/v1"


def get_authorize_url(state: str, api_base: Optional[str] = None) -> str:
    base = (api_base or API_V1).rstrip("/")
    return (
        f"{base}/auth/authorize?"
        + urllib.parse.urlencode({
            "client_id": APP_ID,
            "redirect_uri": CALLBACK_URL,
            "response_type": "code",
            "state": state,
        })
    )


# 使用带签名的 state，不依赖 Cookie，避免跨站/localhost 与 127.0.0.1 混用导致 state 一直刷新或不匹配
def make_signed_state() -> str:
    raw = secrets.token_urlsafe(16)
    sig = hmac.new(APP_SECRET.encode(), raw.encode(), hashlib.sha256).hexdigest()
    return base64.urlsafe_b64encode(f"{raw}.{sig}".encode()).decode().rstrip("=")


def verify_signed_state(state: str) -> bool:
    if not state:
        return False
    try:
        pad = 4 - len(state) % 4
        if pad != 4:
            state += "=" * pad
        decoded = base64.urlsafe_b64decode(state.encode()).decode()
        raw, sig = decoded.rsplit(".", 1)
        expected = hmac.new(APP_SECRET.encode(), raw.encode(), hashlib.sha256).hexdigest()
        return hmac.compare_digest(sig, expected)
    except Exception:
        return False


def _safe_auth_origin(origin: Optional[str]) -> Optional[str]:
    """仅允许与认证中心同源的 origin，用于 SSO 时携带控制台 Cookie。"""
    if not origin or not isinstance(origin, str):
        return None
    o = origin.strip().rstrip("/").lower()
    if not o.startswith("http://") and not o.startswith("https://"):
        return None
    if "localhost" in o or "127.0.0.1" in o:
        return o
    return None


@app.route("/")
def index():
    auth_origin = request.args.get("auth_origin")
    from_workbench = auth_origin and _safe_auth_origin(auth_origin)
    if not session.get("access_token") or from_workbench:
        if from_workbench:
            session.clear()
        state = make_signed_state()
        api_base = None
        if from_workbench:
            api_base = auth_origin.rstrip("/") + "/api/v1"
        return redirect(get_authorize_url(state, api_base))
    # 已登录：可调用认证中心 /users/me 展示用户信息
    try:
        r = requests.get(
            f"{API_V1}/users/me",
            headers={"Authorization": f"Bearer {session['access_token']}"},
            timeout=5,
        )
        if r.status_code == 200:
            user = r.json()
            return (
                "<h1>测试应用 test1</h1>"
                "<p>已通过统一认证系统登录</p>"
                f"<p>用户名: {user.get('username', '-')} | 邮箱: {user.get('email', '-')}</p>"
                '<p><a href="/demo/check-permission">触发「权限检查」审计（写入一条 check_permission 日志）</a></p>'
                '<p><a href="/logout">退出登录</a></p>'
            )
        if r.status_code == 401:
            session.clear()
            return redirect("/logout")
    except Exception as e:
        return (
            f"<h1>测试应用 test1</h1><p>已登录（获取用户信息失败: {e}）</p>"
            '<p><a href="/demo/check-permission">触发「权限检查」审计</a></p>'
            "<p><a href='/logout'>退出登录</a></p>"
        )
    return (
        "<h1>测试应用 test1</h1>"
        "<p>已登录</p>"
        '<p><a href="/demo/check-permission">触发「权限检查」审计</a></p>'
        '<p><a href="/logout">退出登录</a></p>'
    )


@app.route("/oauth/callback")
def oauth_callback():
    code = request.args.get("code")
    state = request.args.get("state")
    if not code:
        return "缺少 code 参数", 400
    if not verify_signed_state(state or ""):
        return "state 不匹配或已失效，请重新登录", 400

    # 用 code 换 token
    r = requests.post(
        f"{API_V1}/auth/token",
        data={
            "grant_type": "authorization_code",
            "code": code,
            "client_id": APP_ID,
            "client_secret": APP_SECRET,
            "redirect_uri": CALLBACK_URL,
        },
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=10,
    )
    if r.status_code != 200:
        return f"换取 token 失败: {r.status_code} {r.text}", 400
    data = r.json()
    session["access_token"] = data.get("access_token")
    session["refresh_token"] = data.get("refresh_token")
    return redirect("/")


@app.route("/demo/check-permission")
def demo_check_permission():
    """调用认证中心 POST /apps/check-permission，便于在管理端审计日志中看到「权限检查」。"""
    token = session.get("access_token")
    if not token:
        return redirect("/")
    perm = f"app:{APP_ID}:access"
    try:
        r = requests.post(
            f"{API_V1}/apps/check-permission",
            params={"app_id": APP_ID, "permission_code": perm},
            headers={"Authorization": f"Bearer {token}"},
            timeout=10,
        )
        body = r.text[:2000]
        return (
            f"<h1>权限检查演示</h1><p>HTTP {r.status_code}</p><pre>{body}</pre>"
            "<p>请到认证中心 <strong>审计日志</strong>，操作类型选「权限检查」筛选验证。</p>"
            '<p><a href="/">返回首页</a></p>'
        )
    except Exception as e:
        return f"<h1>请求失败</h1><p>{e}</p><p><a href='/'>返回</a></p>", 500


@app.route("/logout")
def logout():
    session.clear()
    # 单点登出：先到认证中心清除 SSO Cookie，再跳回本应用首页（否则会因仍有 Cookie 被立即重新登录）
    from urllib.parse import urlparse, urlencode
    base = urlparse(CALLBACK_URL)
    app_base = f"{base.scheme}://{base.netloc}/"
    clear_sso_url = f"{AUTH_CENTER_URL}/api/v1/auth/clear-sso?{urlencode({'next': app_base})}"
    return redirect(clear_sso_url)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
