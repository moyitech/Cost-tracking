from dotenv import load_dotenv
from pydantic_settings import BaseSettings
from pydantic import Field
from typing import Optional

load_dotenv()


class Settings(BaseSettings):
    # 基础配置
    DEBUG_MODE: bool = Field(default=True)
    LOGURU_LEVEL: str = Field(default="DEBUG")

    # 数据库配置
    BIZ_DB_CONNECTION: str = Field(default="sqlite:///./data/cost_tracking.db")

    # Redis配置
    REDIS_CONNECTION: str = Field(default="redis://localhost:6379/0")

    # JWT配置
    SECRET_KEY: str = Field(default="your-super-secret-key-change-in-production")
    ALGORITHM: str = Field(default="HS256")
    ACCESS_TOKEN_EXPIRE_MINUTES: int = Field(default=30 * 24 * 60)  # 30天
    REFRESH_TOKEN_EXPIRE_MINUTES: int = Field(default=7 * 24 * 60)  # 7天

    # 微信登录配置
    WX_APPID: str = Field(...)
    WX_APPSECRET: str = Field(...)
    WX_REDIRECT_URI: Optional[str] = Field(default=None)

    # 应用配置
    APP_NAME: str = Field(default="Cost Tracking")
    APP_VERSION: str = Field(default="1.0.0")
    APP_DESCRIPTION: str = Field(default="物品成本计算器")

    # CORS配置
    ALLOWED_ORIGINS: list[str] = Field(default=["http://localhost:3000", "http://localhost:5173"])

    # 文件上传配置（如果需要头像等）
    MAX_UPLOAD_SIZE: int = Field(default=5 * 1024 * 1024)  # 5MB
    UPLOAD_DIR: str = Field(default="./uploads")

    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings()  # type: ignore

if __name__ == "__main__":
    print(settings.model_dump_json(indent=2, exclude_none=True))