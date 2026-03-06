"""
用户相关Schema
"""
from typing import List, Optional
from pydantic import BaseModel, EmailStr, field_validator


class UserBatchDeleteRequest(BaseModel):
    """批量删除用户请求"""
    user_ids: List[int]


class UserBase(BaseModel):
    """
    用户基础模型
    """
    username: str
    email: EmailStr
    full_name: Optional[str] = None


class UserCreate(UserBase):
    """
    用户创建模型（权限仅通过角色分配，不再使用 is_admin）
    """
    password: str


class UserCreateByAdmin(UserCreate):
    """管理员创建用户（可同时分配角色）"""
    role_ids: Optional[List[int]] = None


class UserUpdate(BaseModel):
    """
    用户更新模型（权限仅通过角色分配）
    """
    email: Optional[EmailStr] = None
    full_name: Optional[str] = None
    password: Optional[str] = None
    is_active: Optional[bool] = None

    @field_validator("email", mode="before")
    @classmethod
    def empty_email_to_none(cls, v):
        if v == "" or v is None:
            return None
        return v


class UserRoleInfo(BaseModel):
    """用户关联角色的简要信息"""
    id: int
    name: str
    description: Optional[str] = None

    class Config:
        from_attributes = True


class UserResponse(UserBase):
    """
    用户响应模型（仅通过 roles 表示权限，不再返回 is_admin）
    """
    id: int
    is_active: bool
    roles: List[UserRoleInfo] = []

    class Config:
        from_attributes = True

