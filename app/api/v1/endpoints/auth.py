"""
登录接口 (OAuth2 Password Flow)
"""
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request, status, Query, Form
from fastapi.security import OAuth2PasswordRequestForm
from fastapi.responses import RedirectResponse, JSONResponse
from sqlalchemy.orm import Session

from app.core.config import settings
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
from app.api.deps import get_current_user, get_current_user_from_cookie_or_bearer, get_db
from app.crud import crud_user, crud_session, crud_audit, crud_app
from app.models.session import Session as SessionModel
from app.schemas.token import Token
from app.models.user import User

router = APIRouter()


def _redirect_uri_matches_app(redirect_uri: str, app_callback_url: Optional[str]) -> bool:
    """校验 redirect_uri 与应用注册的 callback_url 一致，防止授权码劫持。"""
    if not app_callback_url or not app_callback_url.strip():
        return False
    return redirect_uri.strip() == app_callback_url.strip()


@router.post("/login")
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
    """
    try:
        user = crud_user.authenticate(
            db, username=form_data.username, password=form_data.password
        )
        if not user:
            # 记录审计：登录失败
            crud_audit.create_log(
                db,
                actor_user_id=None,
                action="login",
                app_id=None,
                resource=None,
                ip=request.client.host if request and request.client else None,
                user_agent=request.headers.get("user-agent") if request else None,
                success=False,
                details='{"reason": "bad_credentials_or_locked"}',
            )
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="用户名或密码错误",
                headers={"WWW-Authenticate": "Bearer"},
            )
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
            expires_at=refresh_expires_at,
            ip=request.client.host if request and request.client else None,
            user_agent=request.headers.get("user-agent") if request else None,
        )
        db.add(session_obj)
        db.commit()

        # 审计：登录成功
        crud_audit.create_log(
            db,
            actor_user_id=user.id,
            action="login",
            app_id=None,
            resource=None,
            ip=request.client.host if request and request.client else None,
            user_agent=request.headers.get("user-agent") if request else None,
            success=True,
            details='{}',
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
    登出接口：撤销服务端会话（refresh token 失效），并清除 SSO Cookie。
    """
    # 优先从 Bearer 或 Cookie 获取 token，以便撤销对应会话
    token: Optional[str] = request.cookies.get(SSO_COOKIE_NAME)
    if not token:
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.lower().startswith("bearer "):
            token = auth_header[7:].strip()
    if token:
        try:
            payload = verify_token(token)
            jti = payload.get("jti")
            if jti:
                sess = crud_session.crud_session.get_by_jti(db, jti=jti)
                if sess and crud_session.crud_session.is_active(sess):
                    crud_session.crud_session.revoke(db, db_obj=sess)
        except (ValueError, Exception):
            pass
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
async def introspect(
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
        return {
            "active": True,
            "sub": payload.get("sub"),
            "client_id": payload.get("sub"),  # 兼容旧字段
            "exp": payload.get("exp"),
            "iat": payload.get("iat"),
            "jti": payload.get("jti"),
            "iss": payload.get("iss"),
            "aud": payload.get("aud"),
        }
    except ValueError:
        return {"active": False}


@router.get("/sessions/me")
async def list_my_sessions(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """列出当前用户的活跃会话（可查看并管理）。"""
    from datetime import datetime
    sessions = crud_session.get_by_user_id(db, user_id=current_user.id)
    now = datetime.utcnow()
    return [
        {
            "jti": s.jti,
            "created_at": s.created_at.isoformat() if s.created_at else None,
            "expires_at": s.expires_at.isoformat() if s.expires_at else None,
            "revoked": s.revoked_at is not None,
            "ip": s.ip,
            "user_agent": (s.user_agent[:80] + "…") if s.user_agent and len(s.user_agent) > 80 else s.user_agent,
            "active": s.revoked_at is None and (s.expires_at and s.expires_at > now),
        }
        for s in sessions
    ]


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
    return {"message": "会话已撤销"}

