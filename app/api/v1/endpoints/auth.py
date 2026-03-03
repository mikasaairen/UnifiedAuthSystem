"""
登录接口 (OAuth2 Password Flow)
"""
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request, status, Query, Form
from fastapi.security import OAuth2PasswordRequestForm
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import (
    create_access_token,
    create_refresh_token,
    hash_token,
    new_jti,
    verify_token,
    verify_password
)
from app.core.auth_code_store import generate_authorization_code
from app.api.deps import get_current_user, get_db
from app.crud import crud_user, crud_session, crud_audit, crud_app
from app.models.session import Session as SessionModel
from app.schemas.token import Token
from app.models.user import User

router = APIRouter()


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
    OAuth2 兼容的登录接口。
    - 若请求带 client_id、redirect_uri（OAuth 授权码流程），则校验通过后生成授权码并返回 redirect_url，不返回 token。
    - 否则返回 access_token + refresh_token，供控制台使用。
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

        # OAuth2 授权码流程：带 client_id + redirect_uri 时，生成 code 并返回重定向 URL
        if client_id and redirect_uri:
            app = crud_app.get_by_app_id(db, app_id=client_id)
            if app and app.status == "active":
                code = generate_authorization_code(
                    user_id=user.id,
                    username=user.username,
                    client_id=client_id,
                    redirect_uri=redirect_uri,
                    state=state or "",
                )
                sep = "&" if "?" in redirect_uri else "?"
                redirect_url = f"{redirect_uri}{sep}code={code}&state={state or ''}"
                return {"redirect_url": redirect_url}

        return Token(
            access_token=access_token,
            refresh_token=refresh_token,
            token_type="bearer",
            expires_in=expires_in,
        )
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
    current_user: User = Depends(get_current_user)
):
    """
    登出接口（简化版）：客户端删除 token 即可。
    说明：严格的“服务端撤销”需要客户端同时传 refresh_token 或 jti，
    我们在后续会在管理台/前端把 refresh_token 也接入，从而做到真正的会话撤销。
    """
    return {"message": "登出成功"}


@router.get("/authorize")
async def authorize(
    client_id: str,
    redirect_uri: str,
    response_type: str = "code",
    scope: str = "",
    state: str = "",
    db: Session = Depends(get_db)
):
    """
    授权码模式的授权端点。未登录时重定向到登录页并带上参数；已登录且带 Cookie/Token 时由前端调用 create_authorization_code 获取 code 并跳转。
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
    db: Session = Depends(get_db)
):
    """
    令牌内省端点，用于验证令牌有效性。返回 iss/aud 以支持应用间信任校验。
    """
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

