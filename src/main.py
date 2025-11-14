from fastapi import FastAPI, HTTPException
from fastapi.concurrency import asynccontextmanager
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse


from src.router.items import router as items_router
from src.router.auth import router as auth_router
from src.router.stats import router as stats_router
from src.conf.env import settings
from src.db.redis_client import init_redis, close_redis

# 创建FastAPI应用


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 应用启动
    await init_redis()
    yield
    # 应用关闭
    await close_redis()


app = FastAPI(
    title=settings.APP_NAME,
    description=settings.APP_DESCRIPTION,
    version=settings.APP_VERSION,
    lifespan=lifespan,
    docs_url="/docs" if settings.DEBUG_MODE else None,
    redoc_url="/redoc" if settings.DEBUG_MODE else None
)

# 配置CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册路由
app.include_router(auth_router)
app.include_router(items_router)
app.include_router(stats_router)


@app.get("/ping")
async def ping():
    """健康检查接口"""
    return {
        "message": "pong",
        "app": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "debug": settings.DEBUG_MODE
    }


@app.get("/")
async def root():
    """根路径"""
    return {
        "message": f"欢迎使用{settings.APP_NAME}",
        "version": settings.APP_VERSION,
        "description": settings.APP_DESCRIPTION,
        "docs": "/docs" if settings.DEBUG_MODE else "文档已禁用"
    }


# 全局异常处理
@app.exception_handler(HTTPException)
async def http_exception_handler(request, exc):
    """HTTP异常处理器"""
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "success": False,
            "message": exc.detail,
            "code": exc.status_code
        }
    )


@app.exception_handler(Exception)
async def general_exception_handler(request, exc):
    """通用异常处理器"""
    if settings.DEBUG_MODE:
        # 调试模式下返回详细错误信息
        import traceback
        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "message": "服务器内部错误",
                "error": str(exc),
                "traceback": traceback.format_exc(),
                "code": 500
            }
        )
    else:
        # 生产模式下只返回简单错误信息
        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "message": "服务器内部错误",
                "code": 500
            }
        )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "src.main:app",
        host="0.0.0.0",
        port=8000,
        reload=settings.DEBUG_MODE,
        log_level="debug" if settings.DEBUG_MODE else "info"
    )