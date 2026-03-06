"""
RBAC 相关 Schema：角色、权限、资源
"""
from typing import Optional, List
from pydantic import BaseModel


class RoleBase(BaseModel):
    """角色基础模型"""
    name: str
    description: Optional[str] = None


class RoleCreate(RoleBase):
    """角色创建模型"""
    pass


class RoleUpdate(BaseModel):
    """角色更新模型"""
    name: Optional[str] = None
    description: Optional[str] = None


class RoleResponse(RoleBase):
    """角色响应模型"""
    id: int

    class Config:
        from_attributes = True


class RoleResponseWithCount(RoleResponse):
    """角色响应（含权限数量，用于列表）"""
    permission_count: int = 0


class BatchRoleIdsRequest(BaseModel):
    """批量删除角色请求"""
    role_ids: List[int]


class BatchPermissionIdsRequest(BaseModel):
    """批量删除权限请求"""
    permission_ids: List[int]


class BatchResourceIdsRequest(BaseModel):
    """批量删除资源请求"""
    resource_ids: List[int]


class PermissionBase(BaseModel):
    """权限基础模型"""
    code: str
    name: str
    resource_id: int
    description: Optional[str] = None


class PermissionCreate(PermissionBase):
    """权限创建模型"""
    pass


class PermissionUpdate(BaseModel):
    """权限更新模型"""
    code: Optional[str] = None
    name: Optional[str] = None
    resource_id: Optional[int] = None
    description: Optional[str] = None


class PermissionResponse(PermissionBase):
    """权限响应模型"""
    id: int

    class Config:
        from_attributes = True


class PermissionResponseWithResource(PermissionResponse):
    """权限响应（含关联资源信息，便于细粒度展示）"""
    resource_name: Optional[str] = None
    resource_path: Optional[str] = None
    resource_type: Optional[str] = None


class ResourceBase(BaseModel):
    """资源基础模型"""
    app_id: int
    name: str
    resource_type: str  # api/ui/other
    path: str
    method: Optional[str] = None
    description: Optional[str] = None


class ResourceCreate(ResourceBase):
    """资源创建模型"""
    pass


class ResourceUpdate(BaseModel):
    """资源更新模型"""
    name: Optional[str] = None
    resource_type: Optional[str] = None
    path: Optional[str] = None
    method: Optional[str] = None
    description: Optional[str] = None


class ResourceResponse(ResourceBase):
    """资源响应模型"""
    id: int
    
    class Config:
        from_attributes = True


class RolePermissionAssign(BaseModel):
    """角色权限分配模型"""
    permission_ids: List[int]


class UserRoleAssign(BaseModel):
    """用户角色分配模型"""
    role_ids: List[int]
