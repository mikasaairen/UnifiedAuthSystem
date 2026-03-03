"""
应用相关Schema
"""
from typing import Optional, List
from pydantic import BaseModel


class BatchAppItem(BaseModel):
    """批量注册单条应用"""
    app_name: str
    description: Optional[str] = None
    callback_url: Optional[str] = None


class BatchRegisterRequest(BaseModel):
    """批量注册请求"""
    apps: List[BatchAppItem]


class BatchIdsRequest(BaseModel):
    """批量操作请求（app_id 列表）"""
    app_ids: List[str]


class BatchCallbackUpdate(BaseModel):
    """单条回调地址更新"""
    app_id: str
    callback_url: Optional[str] = None


class BatchCallbacksRequest(BaseModel):
    """批量更新回调地址"""
    updates: List[BatchCallbackUpdate]


class ApplicationBase(BaseModel):
    """
    应用基础模型
    """
    app_name: str
    description: Optional[str] = None
    callback_url: Optional[str] = None


class ApplicationCreate(ApplicationBase):
    """
    应用创建模型（app_id 和 app_secret 由系统生成）
    """
    app_id: Optional[str] = None  # 可选，不提供则自动生成
    app_secret: Optional[str] = None  # 可选，不提供则自动生成


class ApplicationUpdate(BaseModel):
    """
    应用更新模型
    """
    app_name: Optional[str] = None
    description: Optional[str] = None
    callback_url: Optional[str] = None
    status: Optional[str] = None  # pending/active/disabled


class ApplicationResponse(ApplicationBase):
    """
    应用响应模型
    """
    id: int
    app_id: str
    status: str
    is_active: bool
    
    class Config:
        from_attributes = True


class ApplicationRegisterResponse(BaseModel):
    """
    应用注册响应（包含 app_secret，仅返回一次）
    """
    id: int
    app_id: str
    app_secret: str  # 仅注册时返回，后续不再返回
    app_name: str
    status: str
    message: Optional[str] = None


class BatchRegisterResponse(BaseModel):
    """批量注册响应（含每个应用的 app_secret，仅此一次返回）"""
    items: List[ApplicationRegisterResponse]
    message: str = "请妥善保存下方密钥，关闭后将无法再次查看"

