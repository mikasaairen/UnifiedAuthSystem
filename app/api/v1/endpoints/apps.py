"""
应用接入管理接口
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query, Header
from sqlalchemy.orm import Session

from app.api.deps import get_current_active_user, get_current_admin_user, get_db
from app.core.cors import invalidate_cors_cache
from app.crud import crud_app, crud_audit
from app.models.user import User
from app.schemas.application import (
    ApplicationCreate, ApplicationUpdate, ApplicationResponse, ApplicationRegisterResponse,
    BatchRegisterRequest, BatchRegisterResponse, BatchAppItem,
    BatchIdsRequest, BatchCallbacksRequest, BatchCallbackUpdate,
)
from fastapi import Request

router = APIRouter()


# ========== 应用注册和管理（管理员专用）==========
@router.post("/register", response_model=ApplicationRegisterResponse, status_code=status.HTTP_201_CREATED)
async def register_application(
    app_in: ApplicationCreate,
    request: Request,
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """
    注册新应用（管理员专用）
    返回 app_id 和 app_secret（仅返回一次，请妥善保存）
    """
    # 检查 app_id 是否已存在
    if app_in.app_id:
        existing = crud_app.get_by_app_id(db, app_id=app_in.app_id)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="应用ID已存在"
            )
    
    # 创建应用（自动生成 app_id 和 app_secret），id 复用已删除记录的 id
    import secrets
    from app.core.security import get_password_hash
    from app.models.application import Application
    from app.crud.base import get_next_available_id

    app_id = app_in.app_id if app_in.app_id else secrets.token_urlsafe(16)
    app_secret = app_in.app_secret if app_in.app_secret else secrets.token_urlsafe(32)
    new_id = get_next_available_id(db, Application)
    db_obj = Application(
        id=new_id,
        app_id=app_id,
        app_name=app_in.app_name,
        description=app_in.description,
        app_secret_hash=get_password_hash(app_secret),
        status="pending",
        is_active=False,
        callback_url=app_in.callback_url
    )
    db.add(db_obj)
    db.commit()
    db.refresh(db_obj)
    
    # 记录审计日志
    crud_audit.create_log(
        db,
        actor_user_id=current_user.id,
        action="app_register",
        app_id=db_obj.id,
        resource=None,
        ip=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        success=True,
        details=f'{{"app_id": "{app_id}", "app_name": "{app_in.app_name}"}}'
    )
    
    return ApplicationRegisterResponse(
        id=db_obj.id,
        app_id=app_id,
        app_secret=app_secret,  # 仅返回一次
        app_name=db_obj.app_name,
        status=db_obj.status,
        message="应用注册成功，请妥善保存 app_secret"
    )


@router.post("/batch-register", response_model=BatchRegisterResponse, status_code=status.HTTP_201_CREATED)
async def batch_register_applications(
    body: BatchRegisterRequest,
    request: Request,
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """
    批量注册应用（管理员专用）。返回每个应用的 app_id、app_secret（仅此一次，请下载保存）。
    """
    import secrets
    from app.core.security import get_password_hash
    from app.models.application import Application
    from app.crud.base import get_next_available_id

    if not body.apps or len(body.apps) > 50:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="请提供 1～50 个应用信息"
        )

    items = []
    for item in body.apps:
        app_id = secrets.token_urlsafe(16)
        app_secret = secrets.token_urlsafe(32)
        new_id = get_next_available_id(db, Application)
        db_obj = Application(
            id=new_id,
            app_id=app_id,
            app_name=item.app_name,
            description=item.description,
            app_secret_hash=get_password_hash(app_secret),
            status="pending",
            is_active=False,
            callback_url=item.callback_url
        )
        db.add(db_obj)
        db.commit()
        db.refresh(db_obj)
        crud_audit.create_log(
            db,
            actor_user_id=current_user.id,
            action="app_register",
            app_id=db_obj.id,
            resource=None,
            ip=request.client.host if request and request.client else None,
            user_agent=request.headers.get("user-agent"),
            success=True,
            details=f'{{"app_id": "{app_id}", "app_name": "{item.app_name}"}}'
        )
        items.append(ApplicationRegisterResponse(
            id=db_obj.id,
            app_id=app_id,
            app_secret=app_secret,
            app_name=db_obj.app_name,
            status=db_obj.status,
            message="请妥善保存 app_secret"
        ))

    return BatchRegisterResponse(items=items)


@router.get("/", response_model=List[ApplicationResponse])
async def list_applications(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    status_filter: str = Query(None, description="状态过滤：pending/active/disabled"),
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """
    获取应用列表（管理员专用）
    """
    apps = crud_app.get_multi(db, skip=skip, limit=limit)
    if status_filter:
        apps = [app for app in apps if app.status == status_filter]
    return apps


@router.post("/{app_id}/approve", response_model=ApplicationResponse)
async def approve_application(
    app_id: str,
    request: Request,
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """
    审核通过应用（管理员专用）
    """
    app = crud_app.update_status(db, app_id=app_id, status="active")
    if not app:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="应用不存在"
        )
    
    # 记录审计日志
    crud_audit.create_log(
        db,
        actor_user_id=current_user.id,
        action="app_approve",
        app_id=app.id,
        resource=None,
        ip=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        success=True,
        details=f'{{"app_id": "{app_id}"}}'
    )
    invalidate_cors_cache()
    return app


@router.post("/{app_id}/disable", response_model=ApplicationResponse)
async def disable_application(
    app_id: str,
    request: Request,
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """
    禁用应用（管理员专用）
    """
    app = crud_app.update_status(db, app_id=app_id, status="disabled")
    if not app:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="应用不存在"
        )
    
    # 记录审计日志
    crud_audit.create_log(
        db,
        actor_user_id=current_user.id,
        action="app_disable",
        app_id=app.id,
        resource=None,
        ip=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        success=True,
        details=f'{{"app_id": "{app_id}"}}'
    )
    
    return app


@router.post("/{app_id}/enable", response_model=ApplicationResponse)
async def enable_application(
    app_id: str,
    request: Request,
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """
    启用应用（管理员专用），将状态设为 active
    """
    app = crud_app.update_status(db, app_id=app_id, status="active")
    if not app:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="应用不存在"
        )
    crud_audit.create_log(
        db,
        actor_user_id=current_user.id,
        action="app_enable",
        app_id=app.id,
        resource=None,
        ip=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        success=True,
        details=f'{{"app_id": "{app_id}"}}'
    )
    invalidate_cors_cache()
    return app


@router.post("/delete", status_code=status.HTTP_204_NO_CONTENT)
async def delete_application_post(
    request: Request,
    app_id: str = Query(..., description="应用ID"),
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """
    删除应用（管理员专用，POST方法）
    """
    app = crud_app.get_by_app_id(db, app_id=app_id)
    if not app:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="应用不存在"
        )
    
    # 删除应用
    crud_app.remove(db, id=app.id)
    
    # 记录审计日志
    crud_audit.create_log(
        db,
        actor_user_id=current_user.id,
        action="app_delete",
        app_id=app.id,
        resource=None,
        ip=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        success=True,
        details=f'{{"app_id": "{app_id}"}}'
    )
    
    return None


@router.get("/{app_id}", response_model=ApplicationResponse)
async def get_application(
    app_id: str,
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """
    获取应用详情（管理员专用）
    """
    app = crud_app.get_by_app_id(db, app_id=app_id)
    if not app:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="应用不存在"
        )
    return app


@router.put("/{app_id}", response_model=ApplicationResponse)
async def update_application(
    app_id: str,
    app_in: ApplicationUpdate,
    request: Request,
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """
    更新应用信息（管理员专用）
    """
    app = crud_app.get_by_app_id(db, app_id=app_id)
    if not app:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="应用不存在"
        )
    
    app = crud_app.update(db, db_obj=app, obj_in=app_in)
    
    # 如果更新了状态，同步更新 is_active
    if app_in.status:
        app.is_active = (app_in.status == "active")
        db.commit()
        db.refresh(app)
    
    # 记录审计日志
    crud_audit.create_log(
        db,
        actor_user_id=current_user.id,
        action="app_update",
        app_id=app.id,
        resource=None,
        ip=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        success=True,
        details=f'{{"app_id": "{app_id}", "status": "{app.status}"}}'
    )
    invalidate_cors_cache()
    return app


@router.delete("/{app_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_application(
    app_id: str,
    request: Request,
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """
    删除应用（管理员专用）
    """
    app = crud_app.get_by_app_id(db, app_id=app_id)
    if not app:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="应用不存在"
        )
    
    # 删除应用
    crud_app.remove(db, id=app.id)
    
    # 记录审计日志
    crud_audit.create_log(
        db,
        actor_user_id=current_user.id,
        action="app_delete",
        app_id=app.id,
        resource=None,
        ip=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        success=True,
        details=f'{{"app_id": "{app_id}"}}'
    )
    
    return None


@router.post("/batch-approve")
async def batch_approve_applications(
    body: BatchIdsRequest,
    request: Request,
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """批量审核通过应用（将 status 设为 active）"""
    updated = 0
    for app_id in body.app_ids:
        app = crud_app.get_by_app_id(db, app_id=app_id)
        if app and app.status != "active":
            app.status = "active"
            app.is_active = True
            db.commit()
            updated += 1
            crud_audit.create_log(
                db, actor_user_id=current_user.id, action="app_approve", app_id=app.id,
                resource=None, ip=request.client.host if request.client else None,
                user_agent=request.headers.get("user-agent"), success=True,
                details=f'{{"app_id": "{app_id}"}}'
            )
    if updated:
        invalidate_cors_cache()
    return {"message": f"已审核通过 {updated} 个应用", "updated_count": updated}


@router.post("/batch-disable")
async def batch_disable_applications(
    body: BatchIdsRequest,
    request: Request,
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """批量禁用应用"""
    updated = 0
    for app_id in body.app_ids:
        app = crud_app.get_by_app_id(db, app_id=app_id)
        if app:
            app.status = "disabled"
            app.is_active = False
            db.commit()
            updated += 1
            crud_audit.create_log(
                db, actor_user_id=current_user.id, action="app_disable", app_id=app.id,
                resource=None, ip=request.client.host if request.client else None,
                user_agent=request.headers.get("user-agent"), success=True,
                details=f'{{"app_id": "{app_id}"}}'
            )
    return {"message": f"已禁用 {updated} 个应用", "updated_count": updated}


@router.get("/export")
async def export_applications(
    app_ids: Optional[str] = Query(None, description="逗号分隔的 app_id，不传则导出全部"),
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """批量导出应用配置（不含 app_secret）"""
    ids_list = [x.strip() for x in app_ids.split(",")] if app_ids else None
    apps = crud_app.get_multi(db)
    if ids_list:
        apps = [a for a in apps if a.app_id in ids_list]
    return [
        {
            "app_id": a.app_id,
            "app_name": a.app_name,
            "description": a.description,
            "callback_url": a.callback_url,
            "status": a.status,
            "is_active": a.is_active,
        }
        for a in apps
    ]


@router.post("/batch-delete", status_code=status.HTTP_200_OK)
async def batch_delete_applications(
    body: BatchIdsRequest,
    request: Request,
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """批量删除应用（管理员专用）"""
    deleted = 0
    for app_id in body.app_ids:
        app = crud_app.get_by_app_id(db, app_id=app_id)
        if app:
            crud_app.remove(db, id=app.id)
            deleted += 1
            crud_audit.create_log(
                db, actor_user_id=current_user.id, action="app_delete", app_id=app.id,
                resource=None, ip=request.client.host if request.client else None,
                user_agent=request.headers.get("user-agent"), success=True,
                details=f'{{"app_id": "{app_id}"}}'
            )
    return {"message": f"已删除 {deleted} 个应用", "deleted_count": deleted}


@router.put("/batch-callbacks")
async def batch_update_callbacks(
    body: BatchCallbacksRequest,
    request: Request,
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """批量更新应用回调地址"""
    updated = 0
    for u in body.updates:
        app = crud_app.get_by_app_id(db, app_id=u.app_id)
        if app:
            app.callback_url = u.callback_url
            db.commit()
            updated += 1
    if updated:
        invalidate_cors_cache()
    return {"message": f"已更新 {updated} 个应用的回调地址", "updated_count": updated}


# ========== 授权校验接口（供业务系统调用）==========
@router.post("/check-permission")
async def check_permission(
    app_id: str = Query(..., description="应用ID（也可通过 X-App-Id Header 传递）"),
    permission_code: str = Query(..., description="权限代码"),
    current_user: User = Depends(get_current_active_user),
    request: Request = None,
    db: Session = Depends(get_db)
):
    """
    检查用户对指定应用的权限（统一授权校验接口）
    业务系统调用此接口完成授权决策
    """
    # 验证应用是否存在且已激活
    app = crud_app.get_by_app_id(db, app_id=app_id)
    if not app:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="应用不存在"
        )
    
    if app.status != "active":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="应用未激活"
        )
    
    # 检查用户权限（基于 RBAC）
    has_permission = crud_app.check_user_permission(
        db, user_id=current_user.id, app_id=app_id, permission_code=permission_code
    )
    
    # 记录审计日志
    crud_audit.create_log(
        db,
        actor_user_id=current_user.id,
        action="check_permission",
        app_id=app.id,
        resource=permission_code,
        ip=request.client.host if request and request.client else None,
        user_agent=request.headers.get("user-agent") if request else None,
        success=has_permission,
        details=f'{{"permission_code": "{permission_code}", "result": {has_permission}}}'
    )
    
    return {
        "app_id": app_id,
        "permission_code": permission_code,
        "has_permission": has_permission,
        "user_id": current_user.id,
        "username": current_user.username
    }


@router.get("/list")
async def list_user_apps(
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
):
    """
    获取当前用户可访问的应用列表
    """
    apps = crud_app.get_user_apps(db, user_id=current_user.id)
    return {
        "apps": [
            {
                "app_id": app.app_id,
                "app_name": app.app_name,
                "description": app.description
            }
            for app in apps
        ]
    }

