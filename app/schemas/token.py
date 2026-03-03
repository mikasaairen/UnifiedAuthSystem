"""
Token相关Schema
"""
from pydantic import BaseModel


class Token(BaseModel):
    """
    Token响应模型
    """
    access_token: str
    token_type: str
    expires_in: int | None = None
    refresh_token: str | None = None


class TokenData(BaseModel):
    """
    Token数据模型
    """
    username: str | None = None
    token_type: str | None = None
    jti: str | None = None

