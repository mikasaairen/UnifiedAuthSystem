"""
测试应用 test1 - 统一认证系统外部接入示例
运行在 5000 端口，使用独立虚拟环境。
"""
import os
import secrets
import urllib.parse
from flask import Flask, redirect, request, session, jsonify
import requests

app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET_KEY", "testapp1-dev-secret-change-in-prod")

# 从环境变量读取，未设置则使用下方默认值（与 .env.example 一致）
AUTH_CENTER_URL = os.environ.get("AUTH_CENTER_URL", "http://127.0.0.1:8000").rstrip("/")
APP_ID = os.environ.get("APP_ID", "OBciOp8WXoPqh_YOaM4f7A")
APP_SECRET = os.environ.get("APP_SECRET", "NTsjFQqwXBjZxR-YW7L_Fuer1ttF4B8VWvQCBGu-YeQ")
# 本应用运行在 5000 端口，回调地址必须与在认证中心注册的完全一致
CALLBACK_URL = os.environ.get("CALLBACK_URL", "http://localhost:5000/oauth/callback")
API_V1 = f"{AUTH_CENTER_URL}/api/v1"


def get_authorize_url(state: str) -> str:
    return (
        f"{API_V1}/auth/authorize?"
        + urllib.parse.urlencode({
            "client_id": APP_ID,
            "redirect_uri": CALLBACK_URL,
            "response_type": "code",
            "state": state,
        })
    )


@app.route("/")
def index():
    if not session.get("access_token"):
        state = secrets.token_urlsafe(16)
        session["oauth_state"] = state
        return redirect(get_authorize_url(state))
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
                '<p><a href="/logout">退出登录</a></p>'
            )
    except Exception as e:
        return f"<h1>测试应用 test1</h1><p>已登录（获取用户信息失败: {e}）</p><p><a href='/logout'>退出登录</a></p>"
    return (
        "<h1>测试应用 test1</h1>"
        "<p>已登录</p>"
        '<p><a href="/logout">退出登录</a></p>'
    )


@app.route("/oauth/callback")
def oauth_callback():
    code = request.args.get("code")
    state = request.args.get("state")
    if not code:
        return "缺少 code 参数", 400
    if state != session.get("oauth_state"):
        return "state 不匹配，请重试", 400
    session.pop("oauth_state", None)

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


@app.route("/logout")
def logout():
    session.clear()
    # 可选：跳回认证中心登录页或本应用首页
    return redirect("/")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
