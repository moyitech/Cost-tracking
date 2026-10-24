import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from threading import Event, Thread
from uuid import uuid4
from zoneinfo import ZoneInfo

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from starlette.exceptions import HTTPException

from app.api import router
from app.avatars import router as avatars_router
from app.config import Settings
from app.db import make_engine
from app.errors import ApiError
from app.family_api import router as family_router
from app.import_api import router as import_router
from app.presets import router as presets_router
from app.schemas import DevLogin, ErrorOut, TokenOut
from app.security import DB, login
from app.storage import CosStorage
from app.wechat_codes import WechatCodes
from app.worker import run_worker


def create_app(settings=None, engine=None, storage=None, clock=None):
    settings = settings or Settings()
    owned_engine = engine is None
    engine = engine or make_engine(settings)

    @asynccontextmanager
    async def lifespan(app):
        stop = Event()
        worker = None
        try:
            if settings.ai_enabled and settings.ai_worker_enabled:
                worker = Thread(
                    target=run_worker,
                    args=(engine, settings, app.state.storage, stop),
                    name="ai-worker",
                )
                worker.start()
            yield
        finally:
            stop.set()
            if worker is not None:
                # Drain in-flight recognition before closing its database pool.
                await asyncio.to_thread(worker.join)
            if owned_engine:
                engine.dispose()

    app = FastAPI(
        debug=settings.app_env == "development",
        responses={code: {"model": ErrorOut} for code in (401, 403, 404, 409, 413, 422, 428, 429, 503)},
        title="Cost Tracking API",
        version="0.1.0",
        lifespan=lifespan,
        description="个人档案、AI 截图导入与家庭协作 API。文件由客户端直传 COS。写入版本使用 If-Match，创建及重试使用 Idempotency-Key。",
    )
    app.state.wechat_codes = WechatCodes(settings)
    app.state.settings = settings
    app.state.engine = engine
    app.state.storage = storage or CosStorage(settings)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE"],
        allow_headers=["Authorization", "Content-Type", "If-Match", "Idempotency-Key"],
        expose_headers=["X-Request-ID"],
    )

    @app.middleware("http")
    async def request_context(request, call_next):
        request.state.request_id = "req_" + uuid4().hex
        request.state.today = (
            clock() if clock else datetime.now(ZoneInfo(settings.business_timezone)).date()
        )
        response = await call_next(request)
        response.headers["X-Request-ID"] = request.state.request_id
        return response

    def error_response(request, status, code, message, fields=None, details=None):
        return JSONResponse(
            status_code=status,
            content={
                "error": {
                    "code": code,
                    "message": message,
                    "field_errors": fields or [],
                    "details": details or {},
                    "request_id": getattr(request.state, "request_id", ""),
                }
            },
        )

    @app.exception_handler(ApiError)
    async def business_error(request, exc):
        response = error_response(request, exc.status, exc.code, exc.message, exc.fields, exc.details)
        if exc.status == 429:
            response.headers["Retry-After"] = "2"
        return response

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        # Do not return Pydantic's raw input/context: login inputs contain credentials.
        fields = [
            {
                "field": ".".join(str(p) for p in error["loc"][1:]),
                "code": error["type"],
                "message": error["msg"],
            }
            for error in exc.errors()
        ]
        return error_response(request, 422, "VALIDATION_ERROR", "请求参数不合法", fields)

    @app.exception_handler(HTTPException)
    async def http_error(request, exc):
        return error_response(
            request,
            exc.status_code,
            "NOT_FOUND" if exc.status_code == 404 else "HTTP_ERROR",
            "请求无法处理",
        )

    @app.exception_handler(SQLAlchemyError)
    async def database_error(request, exc):
        logging.getLogger(__name__).error(
            "Database request failed: %s %s", request.state.request_id, type(exc).__name__
        )
        return error_response(request, 503, "SERVICE_UNAVAILABLE", "数据库暂不可用，请稍后重试")

    @app.exception_handler(Exception)
    async def internal_error(request, exc):
        logging.getLogger(__name__).error(
            "Request failed: %s %s", request.state.request_id, type(exc).__name__
        )
        return error_response(request, 500, "INTERNAL_ERROR", "服务暂时异常，请稍后重试")

    @app.get("/api/v1/assets/invitation-cover.png", tags=["families"], response_class=FileResponse,
             responses={200: {"content": {"image/png": {}}, "description": "Public invitation share cover"}})
    def invitation_cover():
        return FileResponse(Path(__file__).parent / "assets" / "invitation-cover.png",
                            media_type="image/png", headers={"Cache-Control": "public, max-age=86400"})

    @app.get("/health", tags=["health"])
    def health():
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        return {"status": "ok"}

    if settings.dev_auth_enabled and settings.app_env in ("development", "test"):

        @app.post(
            "/api/v1/auth/dev/login",
            response_model=TokenOut,
            tags=["auth"],
            description="仅开发/测试环境注册此路由。同一 identity 对应同一个测试用户。",
        )
        def dev_login(body: DevLogin, db: DB):
            return login(db, settings, "dev:" + body.identity)

    app.include_router(router)
    app.include_router(avatars_router)
    app.include_router(family_router)
    app.include_router(import_router)
    app.include_router(presets_router)
    return app


# Use `uv run python -m app`; the factory avoids loading secrets on import.
