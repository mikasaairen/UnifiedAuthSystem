"""
用户相关Schema
"""
from datetime import datetime
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


class ChangePasswordRequest(BaseModel):
    """用户自助修改密码"""
    old_password: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, v):
        if len(v) < 6:
            raise ValueError("新密码长度不能少于6位")
        if len(v) > 72:
            raise ValueError("密码长度不能超过72字节")
        has_upper = any(c.isupper() for c in v)
        has_lower = any(c.islower() for c in v)
        has_digit = any(c.isdigit() for c in v)
        if not (has_upper and has_lower and has_digit):
            raise ValueError("密码需包含大写字母、小写字母和数字")
        return v


class ChangePasswordResponse(BaseModel):
    message: str


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
    locked_until: Optional[datetime] = None
    roles: List[UserRoleInfo] = []
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class UserListResponse(BaseModel):
    """用户列表分页响应"""
    items: List[UserResponse]
    total: int


class DisableUserRequest(BaseModel):
    """禁用用户请求：可选时长，不传则永久禁用"""
    duration: Optional[str] = None  # 15m, 1h, 1d, 7d, 1month, 1year, permanent
    custom_minutes: Optional[int] = None  # 自定义时长（分钟），优先于 duration

