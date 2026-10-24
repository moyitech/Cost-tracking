from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parents[1] / ".env",
        extra="ignore",
        hide_input_in_errors=True,
    )
    app_env: Literal["development", "test", "production"] = "development"
    database_url: SecretStr
    jwt_secret: SecretStr
    business_timezone: Literal["Asia/Shanghai", "Asia/Taipei"] = "Asia/Shanghai"
    log_level: str = "INFO"
    cors_origins: list[str] = []
    dev_auth_enabled: bool = False
    access_token_ttl_seconds: int = Field(default=900, ge=60, le=86400)
    refresh_token_ttl_days: int = Field(default=30, ge=1, le=365)
    wechat_code_env_version: Literal["release", "trial", "develop"] = "release"
    wechat_app_id: str = ""
    wechat_app_secret: SecretStr = SecretStr("")
    storage_provider: Literal["cos"] = "cos"
    cos_secret_id: SecretStr = SecretStr("")
    cos_secret_key: SecretStr = SecretStr("")
    cos_session_token: SecretStr = SecretStr("")
    cos_region: str = ""
    cos_bucket: str = ""
    cos_key_prefix: str = "cost-tracking/development/"
    cos_scheme: Literal["https"] = "https"
    cos_signed_url_ttl_seconds: int = Field(default=300, ge=1, le=3600)
    upload_max_bytes: int = Field(default=10485760, ge=1, le=52428800)
    upload_allowed_mime_types: list[str] = ["image/jpeg", "image/png", "image/webp"]
    # Empty output limit means omit max_tokens from provider requests.
    ai_enabled: bool = False
    ai_worker_enabled: bool = True
    ai_api_key: SecretStr = SecretStr("")
    ai_base_url: str = ""
    ai_model: str = ""
    ai_thinking_enabled: bool = True
    ai_max_output_tokens: int | None = None
    ai_timeout_seconds: int = Field(default=180, ge=10)
    ai_max_concurrency: int = Field(default=2, ge=1)
    ai_import_max_sources: int = Field(default=9, ge=1, le=30)
    ai_import_max_active_sources: int = Field(default=18, ge=1, le=100)
    redis_url: SecretStr = SecretStr("redis://127.0.0.1:26381/0")
    celery_broker_url: SecretStr = SecretStr("redis://127.0.0.1:26381/1")

    @model_validator(mode="before")
    @classmethod
    def empty_optional(cls, values):
        if isinstance(values, dict) and values.get("ai_max_output_tokens") == "":
            values["ai_max_output_tokens"] = None
        return values

    @model_validator(mode="after")
    def validate_secrets(self):
        if len(self.jwt_secret.get_secret_value()) < 32:
            raise ValueError("JWT_SECRET must contain at least 32 characters")
        if self.app_env == "production" and self.dev_auth_enabled:
            raise ValueError("DEV_AUTH_ENABLED must be false in production")
        return self
