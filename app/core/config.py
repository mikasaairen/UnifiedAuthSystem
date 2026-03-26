"""
环境配置（加载环境变量）

说明：
- 你本地的 `.env` 由于编辑器全局忽略规则可能无法自动生成/写入，这里建议使用系统环境变量或手动创建 `.env`。
- 为了兼容 Windows/Linux 与 MySQL，这里默认给出 MySQL 的连接串示例。
"""

from typing import List

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # 项目配置
    PROJECT_NAME: str = "UnifiedAuthSystem"
    VERSION: str = "1.0.0"
    API_V1_STR: str = "/api/v1"
    
    # 安全配置（JWT）
    SECRET_KEY: str = "your-secret-key-change-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    # JWT iss/aud：签发者与受众，用于应用间信任校验
    ISSUER_BASE_URL: str = "UnifiedAuthSystem"
    
    # 数据库配置（MySQL）
    # 默认使用 127.0.0.1，如果使用 localhost 请修改
    DATABASE_URL: str = "mysql+pymysql://root:root@127.0.0.1:3306/unified_auth?charset=utf8mb4"
    
    # CORS 配置
    # 这里单独用一个原始字符串字段接收环境变量，避免 pydantic-settings
    # 把它当作“复杂类型”强制按 JSON 解析从而报错。
    BACKEND_CORS_ORIGINS_RAW: str | None = None

    @property
    def BACKEND_CORS_ORIGINS(self) -> List[str]:
        """
        统一对外提供的 CORS 源列表。
        - 支持 .env 中配置为 JSON 数组字符串
        - 或者用英文逗号分隔的字符串
        - 为空或解析失败时使用默认值
        """
        v = self.BACKEND_CORS_ORIGINS_RAW

        default = ["http://localhost:8000", "http://localhost:3000", "http://localhost:5173", "http://127.0.0.1:5173"]

        if v is None:
            return default

        # 已经是列表的情况（理论上不会从 env 直接得到，但保底兼容）
        if isinstance(v, list):
            return v

        if isinstance(v, str):
            if not v.strip():
                return default

            # 优先尝试按 JSON 解析
            import json

            try:
                parsed = json.loads(v)
                if isinstance(parsed, list):
                    return parsed
            except (json.JSONDecodeError, ValueError, TypeError):
                pass

            # 退化为逗号分隔
            parts = [i.strip() for i in v.split(",") if i.strip()]
            return parts or default

        return default

    # 账户风控策略（登录失败 N 次后自动锁定）
    LOGIN_MAX_FAILS: int = 15
    LOGIN_LOCK_MINUTES: int = 15
    # 同一 (用户名+IP) 登录失败达到此次数后，后续登录必须提交图形验证码
    LOGIN_CAPTCHA_AFTER_FAILS: int = 3
    # 验证码有效期（秒），过期需重新获取
    CAPTCHA_TTL_SECONDS: int = 180
    
    # 是否允许新用户注册（关闭后登录页不显示注册入口，注册接口返回 403）
    ALLOW_REGISTRATION: bool = True
    # 注册审核：开启后新注册用户需管理员审核方可登录
    REQUIRE_REGISTRATION_APPROVAL: bool = False

    # 超级管理员配置
    FIRST_SUPERUSER_USERNAME: str = "admin"
    FIRST_SUPERUSER_EMAIL: str = "admin@example.com"
    FIRST_SUPERUSER_PASSWORD: str = "admin123"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
        env_ignore_empty=True,  # 忽略空的环境变量
    )


settings = Settings()

