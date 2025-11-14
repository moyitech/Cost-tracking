from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from typing import AsyncGenerator
from sqlalchemy import text, select, update, delete, insert, create_engine
from src.conf.env import settings
from src.db.models import Base
import os

# SQLite数据库配置
db_path = settings.BIZ_DB_CONNECTION.replace("sqlite:///", "")
# 确保数据库目录存在
db_dir = os.path.dirname(db_path)
if db_dir and not os.path.exists(db_dir):
    os.makedirs(db_dir, exist_ok=True)

# 异步SQLite引擎
async_url = settings.BIZ_DB_CONNECTION.replace("sqlite:///", "sqlite+aiosqlite:///")
engine = create_async_engine(
    async_url,
    echo=False,  # 设为True可以看到SQL语句
    connect_args={
        "check_same_thread": False,  # SQLite特有配置，允许多线程使用
        "timeout": 20,  # 连接超时时间
    },
    pool_size=10,  # SQLite连接池大小
    max_overflow=0,  # SQLite不建议溢出连接
)

# 同步引擎用于创建表结构
sync_engine = create_engine(
    settings.BIZ_DB_CONNECTION,
    echo=False,
    connect_args={
        "check_same_thread": False,
        "timeout": 20,
    }
)

# 创建表结构
Base.metadata.create_all(bind=sync_engine)  # type: ignore

DBSession = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False
)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with DBSession() as session:
        yield session