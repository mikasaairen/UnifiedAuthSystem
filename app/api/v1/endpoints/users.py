"""
用户管理接口：注册、查询、修改、禁用等
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query, Request
from sqlalchemy.orm import Session

from app.api.deps import get_current_active_user, get_db, require_permission
from app.crud import crud_user, crud_audit
from app.schemas.user import UserCreate, UserCreateByAdmin, UserUpdate, UserResponse, UserBatchDeleteRequest
from app.models.user import User
from app.models.session import Session as SessionModel

router = APIRouter()


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def register(
    user_in: UserCreate,
    request: Request,
    db: Session = Depends(get_db)
):
    """
    用户注册
    """
    # 检查用户名是否已存在
    user = crud_user.get_by_username(db, username=user_in.username)
    if user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="用户名已存在"
        )
    
    # 检查邮箱是否已存在
    user = crud_user.get_by_email(db, email=user_in.email)
    if user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="邮箱已被注册"
        )
    
    # 创建新用户
    user = crud_user.create(db, obj_in=user_in)
    
    # 记录审计日志
    crud_audit.create_log(
        db,
        actor_user_id=None,  # 注册时没有操作人
        target_user_id=user.id,
        action="user_register",
        app_id=None,
        resource=None,
        ip=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        success=True,
        details=f'{{"username": "{user.username}"}}'
    )
    
    return user


@router.post("/", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_user_by_admin(
    user_in: UserCreateByAdmin,
    request: Request,
    current_user: User = Depends(require_permission("users:manage")),
    db: Session = Depends(get_db),
):
    """
    管理员创建用户，可同时分配角色（role_ids）。
    """
    if crud_user.get_by_username(db, username=user_in.username):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="用户名已存在")
    if crud_user.get_by_email(db, email=user_in.email):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="邮箱已被注册")
    role_ids = user_in.role_ids or []
    user = crud_user.create(db, obj_in=user_in)
    if role_ids:
        from app.crud.crud_rbac import crud_role
        try:
            crud_role.assign_to_user(db, user_id=user.id, role_ids=role_ids)
        except ValueError:
            pass
    crud_audit.create_log(
        db,
        actor_user_id=current_user.id,
        target_user_id=user.id,
        action="user_register",
        app_id=None,
        resource=None,
        ip=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        success=True,
        details=f'{{"username": "{user.username}", "by_admin": true}}',
    )
    return user


@router.get("/me", response_model=UserResponse)
async def read_user_me(
    current_user: User = Depends(get_current_active_user)
):
    """
    获取当前用户信息
    """
    return current_user


@router.get("/", response_model=List[UserResponse])
async def list_users(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    is_active: Optional[bool] = Query(None, description="是否激活"),
    role_name: Optional[str] = Query(None, description="按角色名筛选：admin / user / operator"),
    keyword: Optional[str] = Query(None, description="搜索用户名或邮箱（模糊）"),
    current_user: User = Depends(require_permission("users:manage")),
    db: Session = Depends(get_db)
):
    """
    获取用户列表，支持关键词模糊搜索、按角色名筛选，默认按 ID 升序
    """
    from sqlalchemy import or_
    from app.models.rbac import Role
    query = db.query(User)
    if keyword and keyword.strip():
        kw = f"%{keyword.strip()}%"
        query = query.filter(or_(User.username.like(kw), User.email.like(kw)))
    if is_active is not None:
        query = query.filter(User.is_active == is_active)
    if role_name and role_name.strip():
        query = query.join(User.roles).filter(Role.name == role_name.strip()).distinct()
    users = query.order_by(User.id).offset(skip).limit(limit).all()
    return users


@router.get("/{user_id}", response_model=UserResponse)
async def read_user(
    user_id: int,
    current_user: User = Depends(require_permission("users:manage")),
    db: Session = Depends(get_db)
):
    """
    根据ID查询用户信息（用户管理页面使用，需 users:manage 权限）
    """
    user = crud_user.get(db, id=user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="用户不存在"
        )
    return user


@router.put("/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: int,
    user_in: UserUpdate,
    request: Request,
    current_user: User = Depends(require_permission("users:manage")),
    db: Session = Depends(get_db)
):
    """
    更新用户信息（管理员专用）
    """
    user = crud_user.get(db, id=user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="用户不存在"
        )
    
    # 构建更新字典：User 模型字段是 hashed_password，Schema 是 password，需转换
    from app.core.security import get_password_hash
    update_data = user_in.model_dump(exclude_unset=True) if hasattr(user_in, 'model_dump') else user_in.dict(exclude_unset=True)
    if "password" in update_data:
        plain = update_data.pop("password")
        if plain:
            update_data["hashed_password"] = get_password_hash(plain)
    user = crud_user.update(db, db_obj=user, obj_in=update_data)
    
    # 记录审计日志
    crud_audit.create_log(
        db,
        actor_user_id=current_user.id,
        target_user_id=user_id,
        action="user_update",
        app_id=None,
        resource=None,
        ip=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        success=True,
        details=f'{{"user_id": {user_id}}}'
    )
    
    return user


@router.post("/{user_id}/disable", response_model=UserResponse)
async def disable_user(
    user_id: int,
    request: Request,
    current_user: User = Depends(require_permission("users:manage")),
    db: Session = Depends(get_db)
):
    """
    禁用用户（管理员专用）
    """
    user = crud_user.get(db, id=user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="用户不存在"
        )
    
    user.is_active = False
    db.add(user)
    db.commit()
    db.refresh(user)
    
    # 记录审计日志
    crud_audit.create_log(
        db,
        actor_user_id=current_user.id,
        target_user_id=user_id,
        action="user_disable",
        app_id=None,
        resource=None,
        ip=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        success=True,
        details=f'{{"user_id": {user_id}}}'
    )
    
    return user


@router.post("/{user_id}/enable", response_model=UserResponse)
async def enable_user(
    user_id: int,
    request: Request,
    current_user: User = Depends(require_permission("users:manage")),
    db: Session = Depends(get_db)
):
    """
    启用用户（管理员专用）
    """
    user = crud_user.get(db, id=user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="用户不存在"
        )
    
    user.is_active = True
    db.add(user)
    db.commit()
    db.refresh(user)
    
    # 记录审计日志
    crud_audit.create_log(
        db,
        actor_user_id=current_user.id,
        target_user_id=user_id,
        action="user_enable",
        app_id=None,
        resource=None,
        ip=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        success=True,
        details=f'{{"user_id": {user_id}}}'
    )
    
    return user


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: int,
    request: Request,
    current_user: User = Depends(require_permission("users:manage")),
    db: Session = Depends(get_db)
):
    """
    删除用户（管理员专用，不可恢复）
    """
    user = crud_user.get(db, id=user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="用户不存在"
        )
    if user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="不能删除当前登录用户"
        )
    # 先删除该用户的所有会话（sessions.user_id NOT NULL，不能随用户删除被置空）
    db.query(SessionModel).filter(SessionModel.user_id == user_id).delete(synchronize_session=False)
    username = user.username
    crud_user.remove(db, id=user_id)
    crud_audit.create_log(
        db,
        actor_user_id=current_user.id,
        target_user_id=user_id,
        action="user_delete",
        app_id=None,
        resource=None,
        ip=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        success=True,
        details=f'{{"user_id": {user_id}, "username": "{username}"}}'
    )


@router.post("/batch-delete", status_code=status.HTTP_200_OK)
async def batch_delete_users(
    body: UserBatchDeleteRequest,
    request: Request,
    current_user: User = Depends(require_permission("users:manage")),
    db: Session = Depends(get_db)
):
    """批量删除用户（管理员专用）。会跳过当前登录用户，不可删除自己。"""
    deleted = 0
    for uid in body.user_ids:
        if uid == current_user.id:
            continue
        user = crud_user.get(db, id=uid)
        if user:
            db.query(SessionModel).filter(SessionModel.user_id == uid).delete(synchronize_session=False)
            crud_user.remove(db, id=uid)
            deleted += 1
            crud_audit.create_log(
                db, actor_user_id=current_user.id, target_user_id=uid, action="user_delete",
                app_id=None, resource=None, ip=request.client.host if request.client else None,
                user_agent=request.headers.get("user-agent"), success=True,
                details=f'{{"user_id": {uid}}}'
            )
    return {"message": f"已删除 {deleted} 个用户", "deleted_count": deleted}

