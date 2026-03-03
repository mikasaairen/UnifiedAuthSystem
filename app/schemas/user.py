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
    用户创建模型
    """
    password: str
    is_admin: bool = False


class UserUpdate(BaseModel):
    """
    用户更新模型
    """
    email: Optional[EmailStr] = None
    full_name: Optional[str] = None
    password: Optional[str] = None
    is_active: Optional[bool] = None
    is_admin: Optional[bool] = None

    @field_validator("email", mode="before")
    @classmethod
    def empty_email_to_none(cls, v):
        if v == "" or v is None:
            return None
        return v


class UserResponse(UserBase):
    """
    用户响应模型
    """
    id: int
    is_active: bool
    is_admin: bool
    
    class Config:
        from_attributes = True

