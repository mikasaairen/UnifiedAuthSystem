"""
RBAC 管理接口：角色、权限、资源管理
"""
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_admin_user, get_db
from app.crud import crud_role, crud_permission, crud_resource
from app.models.user import User
from app.schemas.rbac import (
    RoleCreate, RoleUpdate, RoleResponse,
    PermissionCreate, PermissionUpdate, PermissionResponse,
    ResourceCreate, ResourceUpdate, ResourceResponse,
    RolePermissionAssign, UserRoleAssign,
    BatchRoleIdsRequest, BatchPermissionIdsRequest, BatchResourceIdsRequest,
)

router = APIRouter()


# ========== 角色管理 ==========
@router.post("/roles", response_model=RoleResponse, status_code=status.HTTP_201_CREATED)
async def create_role(
    role_in: RoleCreate,
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """创建角色（管理员专用）"""
    # 检查角色名是否已存在
    existing = crud_role.get_by_name(db, name=role_in.name)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="角色名称已存在"
        )
    
    role = crud_role.create(db, obj_in=role_in)
    return role


@router.get("/roles", response_model=List[RoleResponse])
async def list_roles(
    skip: int = 0,
    limit: int = 100,
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """获取角色列表（管理员专用）"""
    roles = crud_role.get_multi(db, skip=skip, limit=limit)
    return roles


@router.get("/roles/{role_id}", response_model=RoleResponse)
async def get_role(
    role_id: int,
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """获取角色详情（管理员专用）"""
    role = crud_role.get(db, id=role_id)
    if not role:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="角色不存在"
        )
    return role


@router.put("/roles/{role_id}", response_model=RoleResponse)
async def update_role(
    role_id: int,
    role_in: RoleUpdate,
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """更新角色（管理员专用）"""
    role = crud_role.get(db, id=role_id)
    if not role:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="角色不存在"
        )
    
    # 检查角色名是否冲突
    if role_in.name and role_in.name != role.name:
        existing = crud_role.get_by_name(db, name=role_in.name)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="角色名称已存在"
            )
    
    role = crud_role.update(db, db_obj=role, obj_in=role_in)
    return role


@router.delete("/roles/{role_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_role(
    role_id: int,
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """删除角色（管理员专用）"""
    role = crud_role.get(db, id=role_id)
    if not role:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="角色不存在"
        )
    crud_role.remove(db, id=role_id)
    return None


@router.post("/roles/batch-delete", status_code=status.HTTP_200_OK)
async def batch_delete_roles(
    body: BatchRoleIdsRequest,
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """批量删除角色（管理员专用）"""
    deleted = 0
    for rid in body.role_ids:
        role = crud_role.get(db, id=rid)
        if role:
            crud_role.remove(db, id=rid)
            deleted += 1
    return {"message": f"已删除 {deleted} 个角色", "deleted_count": deleted}


@router.post("/roles/{role_id}/permissions", response_model=RoleResponse)
async def assign_permissions_to_role(
    role_id: int,
    assign: RolePermissionAssign,
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """为角色分配权限（管理员专用）"""
    try:
        role = crud_role.assign_permissions(
            db, role_id=role_id, permission_ids=assign.permission_ids
        )
        return role
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


# ========== 权限管理 ==========
@router.post("/permissions", response_model=PermissionResponse, status_code=status.HTTP_201_CREATED)
async def create_permission(
    permission_in: PermissionCreate,
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """创建权限（管理员专用）"""
    # 检查权限代码是否已存在
    existing = crud_permission.get_by_code(db, code=permission_in.code)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="权限代码已存在"
        )
    
    permission = crud_permission.create(db, obj_in=permission_in)
    return permission


@router.get("/permissions", response_model=List[PermissionResponse])
async def list_permissions(
    skip: int = 0,
    limit: int = 100,
    resource_id: int = None,
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """获取权限列表（管理员专用）"""
    if resource_id:
        permissions = crud_permission.get_by_resource(db, resource_id=resource_id)
    else:
        permissions = crud_permission.get_multi(db, skip=skip, limit=limit)
    return permissions


@router.get("/permissions/{permission_id}", response_model=PermissionResponse)
async def get_permission(
    permission_id: int,
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """获取权限详情（管理员专用）"""
    permission = crud_permission.get(db, id=permission_id)
    if not permission:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="权限不存在"
        )
    return permission


@router.put("/permissions/{permission_id}", response_model=PermissionResponse)
async def update_permission(
    permission_id: int,
    permission_in: PermissionUpdate,
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """更新权限（管理员专用）"""
    permission = crud_permission.get(db, id=permission_id)
    if not permission:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="权限不存在"
        )
    
    # 检查权限代码是否冲突
    if permission_in.code and permission_in.code != permission.code:
        existing = crud_permission.get_by_code(db, code=permission_in.code)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="权限代码已存在"
            )
    
    permission = crud_permission.update(db, db_obj=permission, obj_in=permission_in)
    return permission


@router.delete("/permissions/{permission_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_permission(
    permission_id: int,
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """删除权限（管理员专用）"""
    permission = crud_permission.get(db, id=permission_id)
    if not permission:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="权限不存在"
        )
    crud_permission.remove(db, id=permission_id)
    return None


@router.post("/permissions/batch-delete", status_code=status.HTTP_200_OK)
async def batch_delete_permissions(
    body: BatchPermissionIdsRequest,
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """批量删除权限（管理员专用）"""
    deleted = 0
    for pid in body.permission_ids:
        perm = crud_permission.get(db, id=pid)
        if perm:
            crud_permission.remove(db, id=pid)
            deleted += 1
    return {"message": f"已删除 {deleted} 个权限", "deleted_count": deleted}


# ========== 资源管理 ==========
@router.post("/resources", response_model=ResourceResponse, status_code=status.HTTP_201_CREATED)
async def create_resource(
    resource_in: ResourceCreate,
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """创建资源（管理员专用）"""
    resource = crud_resource.create(db, obj_in=resource_in)
    return resource


@router.get("/resources", response_model=List[ResourceResponse])
async def list_resources(
    skip: int = 0,
    limit: int = 100,
    app_id: int = None,
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """获取资源列表（管理员专用）"""
    if app_id:
        resources = crud_resource.get_by_app(db, app_id=app_id)
    else:
        resources = crud_resource.get_multi(db, skip=skip, limit=limit)
    return resources


@router.get("/resources/{resource_id}", response_model=ResourceResponse)
async def get_resource(
    resource_id: int,
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """获取资源详情（管理员专用）"""
    resource = crud_resource.get(db, id=resource_id)
    if not resource:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="资源不存在"
        )
    return resource


@router.put("/resources/{resource_id}", response_model=ResourceResponse)
async def update_resource(
    resource_id: int,
    resource_in: ResourceUpdate,
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """更新资源（管理员专用）"""
    resource = crud_resource.get(db, id=resource_id)
    if not resource:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="资源不存在"
        )
    resource = crud_resource.update(db, db_obj=resource, obj_in=resource_in)
    return resource


@router.delete("/resources/{resource_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_resource(
    resource_id: int,
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """删除资源（管理员专用）"""
    resource = crud_resource.get(db, id=resource_id)
    if not resource:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="资源不存在"
        )
    crud_resource.remove(db, id=resource_id)
    return None


@router.post("/resources/batch-delete", status_code=status.HTTP_200_OK)
async def batch_delete_resources(
    body: BatchResourceIdsRequest,
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """批量删除资源（管理员专用）"""
    deleted = 0
    for rid in body.resource_ids:
        res = crud_resource.get(db, id=rid)
        if res:
            crud_resource.remove(db, id=rid)
            deleted += 1
    return {"message": f"已删除 {deleted} 个资源", "deleted_count": deleted}


# ========== 用户角色分配 ==========
@router.post("/users/{user_id}/roles", response_model=dict)
async def assign_roles_to_user(
    user_id: int,
    assign: UserRoleAssign,
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """为用户分配角色（管理员专用）"""
    try:
        user = crud_role.assign_to_user(
            db, user_id=user_id, role_ids=assign.role_ids
        )
        return {
            "message": "角色分配成功",
            "user_id": user.id,
            "roles": [{"id": r.id, "name": r.name} for r in user.roles]
        }
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


@router.get("/users/{user_id}/permissions", response_model=List[PermissionResponse])
async def get_user_permissions(
    user_id: int,
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """获取用户的所有权限（管理员专用）"""
    permissions = crud_role.get_user_permissions(db, user_id=user_id)
    return permissions
