from dotenv import load_dotenv
from pydantic_settings import BaseSettings
from pydantic import Field

load_dotenv()


class Settings(BaseSettings):
    DEBUG_MODE: bool = Field(default=True)
    BIZ_DB_CONNECTION: str = Field(...)
    REDIS_CONNECTION: str = Field(...)
    LOGURU_LEVEL: str = Field(default="DEBUG")
    WX_APPID: str = Field()
    WX_APPSECRET: str = Field()
    OSS_ACCESS_KEY_ID: str = Field()
    OSS_ACCESS_KEY_SECRET: str = Field()


settings = Settings()  # type: ignore

if __name__ == "__main__":
    print(settings.model_dump_json(indent=2, exclude_none=True))