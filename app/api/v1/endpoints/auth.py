"""
登录接口 (OAuth2 Password Flow)

登录失败按「用户名 + IP」单独计数与锁定，见 app.core.login_fail_store。
"""
import json
from datetime import datetime, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request, status, Query, Form
from fastapi.security import OAuth2PasswordRequestForm
from fastapi.responses import RedirectResponse, JSONResponse
from sqlalchemy.orm import Session
from app.core.rate_limit import limiter

from app.core.config import settings
from app.core.login_fail_store import is_locked, record_fail, clear as login_fail_clear
from app.api.deps import SSO_COOKIE_NAME
from app.core.security import (
    create_access_token,
    create_refresh_token,
    hash_token,
    new_jti,
    verify_token,
    verify_password
)
from app.core.auth_code_store import generate_authorization_code
from app.core.token_blacklist import add_to_blacklist
from app.api.deps import get_current_user, get_current_user_from_cookie_or_bearer, get_db, oauth2_scheme
from app.crud import crud_user, crud_session, crud_audit, crud_app
from app.models.session import Session as SessionModel
from app.schemas.token import Token
from app.models.user import User

router = APIRouter()

# 滥用检测阈值：同一 IP 短时间锁定账号数 / 同一账号被锁定次数
LOCK_ABUSE_IP_ACCOUNT_COUNT = 3   # 同一 IP 1 小时内锁定的不同账号数
LOCK_ABUSE_USER_LOCK_COUNT = 5     # 同一账号 24 小时内被锁定次数
LOCK_ABUSE_IP_WINDOW_HOURS = 1
LOCK_ABUSE_USER_WINDOW_HOURS = 24


def _check_lock_abuse_and_alert(db: Session, username: str, ip: Optional[str], request: Optional[Request]) -> None:
    """
    检测「同一 IP 短时间触发多账号锁定」「同一账号被多次锁定」并写入 security_alert 日志。
    """
    now = datetime.utcnow()
    ip_window = now - timedelta(hours=LOCK_ABUSE_IP_WINDOW_HOURS)
    user_window = now - timedelta(hours=LOCK_ABUSE_USER_WINDOW_HOURS)
    logs = crud_audit.get_logs(
        db, action="login_lock", start_time=user_window, limit=500
    )
    if not logs:
        return
    ip_to_usernames = {}
    username_lock_count = {}
    for log in logs:
        try:
            d = json.loads(log.details or "{}")
            u = (d.get("username") or "").strip()
        except Exception:
            u = ""
        log_time = log.created_at if hasattr(log, "created_at") and log.created_at else now
        if log.ip and log_time >= ip_window:
            ip_to_usernames.setdefault(log.ip, set()).add(u)
        if u and log_time >= user_window:
            username_lock_count[u] = username_lock_count.get(u, 0) + 1

    client_ip = ip or (request.client.host if request and request.client else None)
    if client_ip and len(ip_to_usernames.get(client_ip, set())) >= LOCK_ABUSE_IP_ACCOUNT_COUNT:
        crud_audit.create_log(
            db,
            actor_user_id=None,
            action="security_alert",
            app_id=None,
            resource=None,
            ip=client_ip,
            user_agent=request.headers.get("user-agent") if request else None,
            success=False,
            details=json.dumps({
                "type": "multi_account_lock_by_ip",
                "ip": client_ip,
                "account_count": len(ip_to_usernames[client_ip]),
                "window_hours": LOCK_ABUSE_IP_WINDOW_HOURS,
            }, ensure_ascii=False),
        )
    if username and username_lock_count.get(username, 0) >= LOCK_ABUSE_USER_LOCK_COUNT:
        crud_audit.create_log(
            db,
            actor_user_id=None,
            action="security_alert",
            app_id=None,
            resource=None,
            ip=client_ip,
            user_agent=request.headers.get("user-agent") if request else None,
            success=False,
            details=json.dumps({
                "type": "repeated_account_lock",
                "username": username,
                "lock_count": username_lock_count[username],
                "window_hours": LOCK_ABUSE_USER_WINDOW_HOURS,
            }, ensure_ascii=False),
        )


def _redirect_uri_matches_app(redirect_uri: str, app_callback_url: Optional[str]) -> bool:
    """校验 redirect_uri 与应用注册的 callback_url 一致，防止授权码劫持。"""
    if not app_callback_url or not app_callback_url.strip():
        return False
    return redirect_uri.strip() == app_callback_url.strip()


@router.post("/login")
@limiter.limit("10/minute")
async def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    client_id: Optional[str] = Form(None),
    redirect_uri: Optional[str] = Form(None),
    state: Optional[str] = Form(None),
    request: Request = None,
    db: Session = Depends(get_db),
):
    """
    OAuth2 兼容的登录接口。带 client_id、redirect_uri 时生成授权码并返回 redirect_url 与 token；否则仅返回 access_token、refresh_token。
    登录失败按 (用户名+IP) 单独计数与锁定，见 login_fail_store。
    """
    client_ip = request.client.host if request and request.client else None
    username = form_data.username

    # 按 (username, ip) 检查是否处于锁定状态
    locked, remaining_sec = is_locked(username, client_ip or "")
    if locked:
        mins, secs = remaining_sec // 60, remaining_sec % 60
        msg = f"该 IP 对此账号的登录尝试过多，请 {mins} 分 {secs} 秒后再试"
        crud_audit.create_log(
            db,
            actor_user_id=None,
            action="login",
            app_id=None,
            resource=None,
            ip=client_ip,
            user_agent=request.headers.get("user-agent") if request else None,
            success=False,
            details=json.dumps({"reason": "ip_username_locked", "remaining_seconds": remaining_sec}, ensure_ascii=False),
        )
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=msg)

    try:
        user = crud_user.authenticate(
            db, username=username, password=form_data.password
        )
        if not user:
            maybe_user = crud_user.get_by_username(db, username=username)
            just_locked = record_fail(username, client_ip or "")
            if just_locked:
                # 同步到 User 表，便于用户管理页面显示并支持手动解封
                if maybe_user:
                    maybe_user.locked_until = datetime.utcnow() + timedelta(minutes=settings.LOGIN_LOCK_MINUTES)
                    db.add(maybe_user)
                    db.commit()
                crud_audit.create_log(
                    db,
                    actor_user_id=maybe_user.id if maybe_user else None,
                    action="login_lock",
                    app_id=None,
                    resource=None,
                    ip=client_ip,
                    user_agent=request.headers.get("user-agent") if request else None,
                    success=False,
                    details=json.dumps({
                        "username": username,
                        "ip": client_ip,
                        "reason": "max_failures",
                        "lock_minutes": settings.LOGIN_LOCK_MINUTES,
                    }, ensure_ascii=False),
                )
                _check_lock_abuse_and_alert(db, username, client_ip, request)
            else:
                crud_audit.create_log(
                    db,
                    actor_user_id=maybe_user.id if maybe_user else None,
                    action="login",
                    app_id=None,
                    resource=None,
                    ip=client_ip,
                    user_agent=request.headers.get("user-agent") if request else None,
                    success=False,
                    details=json.dumps({"reason": "bad_credentials_or_locked"}, ensure_ascii=False),
                )
            if maybe_user and not maybe_user.is_active:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="账户已禁用，请联系管理员解封",
                )
            if maybe_user and maybe_user.locked_until and maybe_user.locked_until > datetime.utcnow():
                delta = maybe_user.locked_until - datetime.utcnow()
                remaining = max(0, int(delta.total_seconds()))
                mins, secs = remaining // 60, remaining % 60
                msg = f"账户已禁用，剩余 {mins} 分 {secs} 秒后可重试"
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=msg,
                )
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="用户名或密码错误",
                headers={"WWW-Authenticate": "Bearer"},
            )

        login_fail_clear(username, client_ip or "")

        if not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="用户未激活"
            )

        # 登录成功：更新登录信息（IP/UA）
        if request is not None:
            user.last_login_at = datetime.utcnow()
            user.last_login_ip = request.client.host if request.client else None
            user.last_user_agent = request.headers.get("user-agent")
            db.add(user)
            db.commit()

        # 同一个 jti 绑定 access+refresh，便于会话管理
        jti = new_jti()
        access_token, expires_in = create_access_token(subject=user.username, jti=jti)
        refresh_token, refresh_expires_at = create_refresh_token(subject=user.username, jti=jti)

        # 落库 refresh token hash（用于撤销/失效）
        session_obj = SessionModel(
            user_id=user.id,
            app_id=None,
            jti=jti,
            refresh_token_hash=hash_token(refresh_token),
            created_at=datetime.utcnow(),
            expires_at=refresh_expires_at,
            ip=request.client.host if request and request.client else None,
            user_agent=request.headers.get("user-agent") if request else None,
        )
        db.add(session_obj)
        db.commit()

        current_ip = request.client.host if request and request.client else None
        ip_changed = (
            user.last_login_ip
            and current_ip
            and user.last_login_ip != current_ip
        )
        login_details = '{"ip_anomaly": true, "prev_ip": "' + (user.last_login_ip or "") + '"}' if ip_changed else '{}'
        crud_audit.create_log(
            db,
            actor_user_id=user.id,
            action="login",
            app_id=None,
            resource=None,
            ip=current_ip,
            user_agent=request.headers.get("user-agent") if request else None,
            success=True,
            details=login_details,
        )
        if ip_changed:
            crud_audit.create_log(
                db,
                actor_user_id=user.id,
                action="security_alert",
                ip=current_ip,
                success=True,
                details=f'{{"type": "ip_change", "prev_ip": "{user.last_login_ip}", "new_ip": "{current_ip}"}}',
            )

        # 单点登录：登录成功后统一设置 SSO Cookie，任意应用/管理端一次登录即可互通
        def _make_login_response(body: dict):
            resp = JSONResponse(content=body)
            resp.set_cookie(
                key=SSO_COOKIE_NAME,
                value=access_token,
                max_age=expires_in,
                path="/",
                httponly=True,
                samesite="lax",
            )
            return resp

        # OAuth2 授权码流程：带 client_id + redirect_uri 时，生成 code（redirect_uri 必须与应用 callback_url 一致）
        if client_id and redirect_uri:
            app = crud_app.get_by_app_id(db, app_id=client_id)
            if not app or app.status != "active":
                pass  # 非 OAuth 流程，直接返回 token
            elif not _redirect_uri_matches_app(redirect_uri, app.callback_url):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="redirect_uri 与应用注册的回调地址不一致"
                )
            else:
                from app.crud.crud_rbac import crud_role
                if not crud_role.check_user_permission(
                    db, user_id=user.id, permission_code=f"app:{client_id}:access"
                ):
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="您暂无该应用的访问权限，请联系管理员分配角色"
                    )
                code = generate_authorization_code(
                    user_id=user.id,
                    username=user.username,
                    client_id=client_id,
                    redirect_uri=redirect_uri,
                    state=state or "",
                )
                sep = "&" if "?" in redirect_uri else "?"
                redirect_url = f"{redirect_uri}{sep}code={code}&state={state or ''}"
                return _make_login_response({
                    "redirect_url": redirect_url,
                    "access_token": access_token,
                    "refresh_token": refresh_token,
                    "token_type": "bearer",
                    "expires_in": expires_in,
                })

        return _make_login_response({
            "access_token": access_token,
            "refresh_token": refresh_token,
            "token_type": "bearer",
            "expires_in": expires_in,
        })
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"登录接口错误：{traceback.format_exc()}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="服务器内部错误",
        )


@router.post("/refresh", response_model=Token)
@limiter.limit("20/minute")
async def refresh_token(
    refresh_token: str,
    request: Request = None,
    db: Session = Depends(get_db),
):
    """
    刷新令牌：
    - 校验 refresh token 的签名与类型
    - 在 sessions 表中查 jti，并校验是否撤销/过期，以及 token 是否匹配 hash
    - 签发新的 access token（可选：滚动 refresh，这里先不滚动，保证实现清晰）
    """
    try:
        payload = verify_token(refresh_token)
    except ValueError:
        raise HTTPException(status_code=401, detail="refresh_token 无效")

    if payload.get("token_type") != "refresh":
        raise HTTPException(status_code=401, detail="refresh_token 类型错误")

    jti = payload.get("jti")
    username = payload.get("sub")
    if not jti or not username:
        raise HTTPException(status_code=401, detail="refresh_token 缺少必要字段")

    db_sess = crud_session.crud_session.get_by_jti(db, jti=jti)
    if not db_sess or not crud_session.crud_session.is_active(db_sess):
        raise HTTPException(status_code=401, detail="会话已失效，请重新登录")

    from app.core.security import verify_token_hash

    if not verify_token_hash(refresh_token, db_sess.refresh_token_hash):
        raise HTTPException(status_code=401, detail="refresh_token 不匹配（可能已被替换）")

    # 签发新的 access token（沿用同一 jti）
    access_token, expires_in = create_access_token(subject=username, jti=jti)

    crud_audit.create_log(
        db,
        actor_user_id=db_sess.user_id,
        action="refresh",
        app_id=db_sess.app_id,
        resource=None,
        ip=request.client.host if request and request.client else None,
        user_agent=request.headers.get("user-agent") if request else None,
        success=True,
        details='{}',
    )

    return Token(access_token=access_token, token_type="bearer", expires_in=expires_in)


@router.post("/logout")
async def logout(
    request: Request,
    db: Session = Depends(get_db),
):
    """
    登出接口：撤销服务端会话（refresh token 失效），并清除 SSO Cookie。记录登出审计日志。
    """
    actor_user_id = None
    token: Optional[str] = request.cookies.get(SSO_COOKIE_NAME)
    if not token:
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.lower().startswith("bearer "):
            token = auth_header[7:].strip()
    if token:
        try:
            payload = verify_token(token)
            username = payload.get("sub")
            jti = payload.get("jti")
            if username:
                u = crud_user.get_by_username(db, username=username)
                if u:
                    actor_user_id = u.id
            if jti:
                add_to_blacklist(jti, ttl_seconds=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60)
                sess = crud_session.get_by_jti(db, jti=jti)
                if sess and crud_session.is_active(sess):
                    crud_session.revoke(db, db_obj=sess)
        except (ValueError, Exception):
            pass
    crud_audit.create_log(
        db,
        actor_user_id=actor_user_id,
        action="logout",
        app_id=None,
        resource=None,
        ip=request.client.host if request and request.client else None,
        user_agent=request.headers.get("user-agent") if request else None,
        success=True,
        details=json.dumps({"message": "用户登出"}, ensure_ascii=False),
    )
    resp = JSONResponse(content={"message": "登出成功"})
    resp.delete_cookie(key=SSO_COOKIE_NAME, path="/", httponly=True, samesite="lax")
    return resp


def _is_safe_redirect_url(url: str) -> bool:
    """仅允许相对路径或本机地址，防止开放重定向。"""
    if not url or not isinstance(url, str):
        return False
    s = url.strip()
    if s.startswith("/") and not s.startswith("//"):
        return True
    try:
        from urllib.parse import urlparse
        p = urlparse(s)
        if not p.netloc:
            return True
        host = (p.netloc or "").split(":")[0].lower()
        return host in ("localhost", "127.0.0.1")
    except Exception:
        return False


@router.get("/clear-sso")
async def clear_sso_cookie(next_url: Optional[str] = Query(None, alias="next")):
    """
    清除 SSO Cookie（无需认证）。支持 next 参数：清除后重定向到该 URL（仅允许相对路径或 localhost/127.0.0.1），供外部应用单点登出后跳回。
    """
    if next_url and _is_safe_redirect_url(next_url):
        resp = RedirectResponse(url=next_url, status_code=302)
    else:
        resp = JSONResponse(content={"message": "已清除单点登录状态"})
    resp.delete_cookie(key=SSO_COOKIE_NAME, path="/", httponly=True, samesite="lax")
    return resp


@router.get("/authorize")
async def authorize(
    client_id: str,
    redirect_uri: str,
    response_type: str = "code",
    scope: str = "",
    state: str = "",
    current_user: Optional[User] = Depends(get_current_user_from_cookie_or_bearer),
    db: Session = Depends(get_db),
):
    """
    授权码模式的授权端点。单点登录：若已携带有效 SSO Cookie 或 Bearer，直接发码并重定向回应用，否则重定向到登录页。
    """
    app = crud_app.get_by_app_id(db, app_id=client_id)
    if not app:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="无效的客户端ID"
        )
    if response_type != "code":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="不支持的响应类型"
        )
    if not _redirect_uri_matches_app(redirect_uri, app.callback_url):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="redirect_uri 与应用注册的回调地址不一致"
        )
    # 仅当用户拥有该应用的访问权限时允许发码
    from app.crud.crud_rbac import crud_role
    app_access_perm = f"app:{client_id}:access"
    if current_user and not crud_role.check_user_permission(
        db, user_id=current_user.id, permission_code=app_access_perm
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="您暂无该应用的访问权限，请联系管理员分配角色"
        )
    # 已登录（Cookie 或 Bearer）：直接生成授权码并重定向，无需再进登录页
    if current_user:
        code = generate_authorization_code(
            user_id=current_user.id,
            username=current_user.username,
            client_id=client_id,
            redirect_uri=redirect_uri,
            state=state,
        )
        sep = "&" if "?" in redirect_uri else "?"
        redirect_url = f"{redirect_uri}{sep}code={code}&state={state}"
        return RedirectResponse(url=redirect_url, status_code=302)
    return RedirectResponse(
        url=f"/login?client_id={client_id}&redirect_uri={redirect_uri}&response_type={response_type}&scope={scope}&state={state}"
    )


@router.get("/create-authorization-code")
async def create_authorization_code_for_logged_in_user(
    client_id: str,
    redirect_uri: str,
    state: str = "",
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    已登录用户获取授权码并得到重定向 URL（用于应用间跳转时已有会话，无需再次输入密码）。
    """
    app = crud_app.get_by_app_id(db, app_id=client_id)
    if not app or app.status != "active":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="无效或未激活的应用")
    if not _redirect_uri_matches_app(redirect_uri, app.callback_url):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="redirect_uri 与应用注册的回调地址不一致"
        )
    from app.crud.crud_rbac import crud_role
    if not crud_role.check_user_permission(
        db, user_id=current_user.id, permission_code=f"app:{client_id}:access"
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="您暂无该应用的访问权限，请联系管理员分配角色"
        )
    code = generate_authorization_code(
        user_id=current_user.id,
        username=current_user.username,
        client_id=client_id,
        redirect_uri=redirect_uri,
        state=state,
    )
    sep = "&" if "?" in redirect_uri else "?"
    redirect_url = f"{redirect_uri}{sep}code={code}&state={state}"
    return {"redirect_url": redirect_url}


@router.post("/token", response_model=Token)
@limiter.limit("20/minute")
async def token(
    grant_type: str = Form(...),
    code: str = Form(None),
    client_id: str = Form(None),
    client_secret: str = Form(None),
    redirect_uri: str = Form(None),
    refresh_token_param: str = Form(None),
    db: Session = Depends(get_db),
    request: Request = None
):
    """
    令牌端点，用于获取access_token
    """
    if grant_type == "authorization_code":
        if not code or not client_id or not client_secret or not redirect_uri:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="缺少必要参数：code, client_id, client_secret, redirect_uri"
            )
        from app.core.auth_code_store import consume_authorization_code

        app = crud_app.get_by_app_id(db, app_id=client_id)
        if not app:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="无效的客户端ID")
        if app.status != "active":
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="应用未激活")
        if not verify_password(client_secret, app.app_secret_hash):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="无效的客户端密钥")

        code_data = consume_authorization_code(code=code, client_id=client_id, redirect_uri=redirect_uri)
        if not code_data:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="授权码无效或已过期，请重新授权"
            )

        username = code_data["username"]
        jti = new_jti()
        access_token, expires_in = create_access_token(subject=username, jti=jti, aud=client_id)
        refresh_token, refresh_expires_at = create_refresh_token(subject=username, jti=jti, aud=client_id)

        session_obj = SessionModel(
            user_id=code_data["user_id"],
            app_id=app.id,
            jti=jti,
            refresh_token_hash=hash_token(refresh_token),
            created_at=datetime.utcnow(),
            expires_at=refresh_expires_at,
            ip=request.client.host if request and request.client else None,
            user_agent=request.headers.get("user-agent") if request else None,
        )
        db.add(session_obj)
        db.commit()

        return Token(
            access_token=access_token,
            refresh_token=refresh_token,
            token_type="bearer",
            expires_in=expires_in,
        )
    elif grant_type == "refresh_token":
        # 刷新令牌模式处理
        return await refresh_token(refresh_token_param, request, db)
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="不支持的授权类型"
        )


@router.post("/introspect")
@limiter.limit("30/minute")
async def introspect(
    request: Request,
    token: str = Form(...),
    client_id: str = Form(..., description="应用ID，需配合 client_secret 完成应用身份校验"),
    client_secret: str = Form(..., description="应用密钥"),
    db: Session = Depends(get_db),
):
    """
    令牌内省端点，用于验证令牌有效性。需提供有效的 client_id 和 client_secret 进行应用身份校验。
    """
    app = crud_app.get_by_app_id(db, app_id=client_id)
    if not app or app.status != "active":
        raise HTTPException(status_code=401, detail="无效的客户端ID或应用未激活")
    if not verify_password(client_secret, app.app_secret_hash):
        raise HTTPException(status_code=401, detail="无效的客户端密钥")
    try:
        payload = verify_token(token)
        from app.core.token_blacklist import is_blacklisted
        jti = payload.get("jti")
        if jti and is_blacklisted(jti):
            return {"active": False}
        return {
            "active": True,
            "sub": payload.get("sub"),
            "client_id": payload.get("sub"),
            "exp": payload.get("exp"),
            "iat": payload.get("iat"),
            "jti": jti,
            "iss": payload.get("iss"),
            "aud": payload.get("aud"),
        }
    except ValueError:
        return {"active": False}


def _to_utc_iso(dt) -> Optional[str]:
    """将 datetime 统一输出为 UTC ISO 字符串（不带时区后缀，前端统一按 UTC 处理）。"""
    if dt is None:
        return None
    if dt.tzinfo is not None:
        from datetime import timezone as _tz
        dt = dt.astimezone(_tz.utc).replace(tzinfo=None)
    return dt.isoformat()


@router.get("/sessions/me")
async def list_my_sessions(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """列出当前用户的活跃会话（可查看并管理）。"""
    now = datetime.utcnow()
    sessions = crud_session.get_by_user_id(db, user_id=current_user.id)
    out = []
    for s in sessions:
        created = s.created_at
        expires = s.expires_at
        if expires:
            is_active = s.revoked_at is None and expires > now
        else:
            is_active = False
        out.append({
            "jti": s.jti,
            "created_at": _to_utc_iso(created),
            "expires_at": _to_utc_iso(expires),
            "revoked": s.revoked_at is not None,
            "ip": s.ip,
            "user_agent": s.user_agent or "",
            "active": is_active,
        })
    return out


@router.delete("/sessions/me")
async def revoke_session(
    jti: str = Query(..., description="要撤销的会话 jti"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """撤销当前用户的指定会话（踢下线）。"""
    sess = crud_session.get_by_jti(db, jti=jti)
    if not sess or sess.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="会话不存在或无权操作")
    crud_session.revoke(db, db_obj=sess)
    add_to_blacklist(jti, ttl_seconds=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60)
    return {"message": "会话已撤销"}


@router.post("/sessions/me/revoke-others")
async def revoke_other_sessions(
    token: str = Depends(oauth2_scheme),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """一键撤销除当前设备外的所有会话；当前请求的 token 对应会话保留。"""
    try:
        payload = verify_token(token)
        current_jti = payload.get("jti")
    except (ValueError, Exception):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="无效的令牌")
    if not current_jti:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="无法识别当前会话")
    ttl = settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60
    sessions = crud_session.get_by_user_id(db, user_id=current_user.id)
    now = datetime.utcnow()
    revoked_count = 0
    for s in sessions:
        if s.jti == current_jti:
            continue
        if s.revoked_at is not None:
            continue
        if not s.expires_at or s.expires_at <= now:
            continue
        crud_session.revoke(db, db_obj=s)
        add_to_blacklist(s.jti, ttl_seconds=ttl)
        revoked_count += 1
    return {"message": "已退出其它设备", "revoked_count": revoked_count}

