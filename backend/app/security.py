import hashlib
import secrets
from datetime import timedelta
from typing import Annotated

import httpx
import jwt
from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.db import get_db
from app.errors import ApiError
from app.models import LoginSession, Member, RefreshToken, Space, User, now
from app.schemas import UserOut

DB = Annotated[Session, Depends(get_db, scope="function")]
bearer = HTTPBearer(auto_error=False)


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def advisory_lock(db, value):
    key = int.from_bytes(hashlib.sha256(value.encode()).digest()[:8], signed=True)
    db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": key})


def issue_tokens(db, settings, user, session=None):
    if session is None:
        session = LoginSession(
            user_id=user.id, expires_at=now() + timedelta(days=settings.refresh_token_ttl_days)
        )
        db.add(session)
        db.flush()
    refresh = secrets.token_urlsafe(48)
    db.add(RefreshToken(digest=digest(refresh), session_id=session.id))
    access = jwt.encode(
        {
            "sub": user.id,
            "sid": session.id,
            "iat": now(),
            "exp": now() + timedelta(seconds=settings.access_token_ttl_seconds),
            "kind": "access",
        },
        settings.jwt_secret.get_secret_value(),
        algorithm="HS256",
    )
    return {
        "access_token": access,
        "refresh_token": refresh,
        "token_type": "bearer",
        "expires_in": settings.access_token_ttl_seconds,
        "user": UserOut.model_validate(user),
    }


def login(db, settings, identity):
    advisory_lock(db, "identity:" + identity)
    user = db.scalar(select(User).where(User.identity == identity))
    if user is None:
        user = User(identity=identity)
        db.add(user)
        db.flush()
        space = Space(name="个人空间", kind="personal", personal_owner_id=user.id)
        db.add(space)
        db.flush()
        db.add(Member(space_id=space.id, user_id=user.id, role="admin"))
    return issue_tokens(db, settings, user)


def wechat_identity(settings, code):
    if not settings.wechat_app_id or not settings.wechat_app_secret.get_secret_value():
        raise ApiError(503, "SERVICE_UNAVAILABLE", "微信登录尚未配置")
    try:
        with httpx.Client(timeout=15) as client:
            response = client.get(
                "https://api.weixin.qq.com/sns/jscode2session",
                params={
                    "appid": settings.wechat_app_id,
                    "secret": settings.wechat_app_secret.get_secret_value(),
                    "js_code": code,
                    "grant_type": "authorization_code",
                },
            )
            response.raise_for_status()
            data = response.json()
    except (httpx.HTTPError, ValueError):
        raise ApiError(503, "SERVICE_UNAVAILABLE", "微信登录暂不可用") from None
    if not data.get("openid"):
        raise ApiError(401, "UNAUTHENTICATED", "微信登录凭证已失效，请重新登录")
    return f"wechat:{settings.wechat_app_id}:{data['openid']}"


def current_user(
    request: Request,
    db: DB,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
):
    if credentials is None:
        raise ApiError(401, "UNAUTHENTICATED", "请先登录")
    try:
        payload = jwt.decode(
            credentials.credentials,
            request.app.state.settings.jwt_secret.get_secret_value(),
            algorithms=["HS256"],
            options={"require": ["sub", "sid", "exp", "iat"]},
        )
        if payload.get("kind") != "access":
            raise jwt.InvalidTokenError()
    except jwt.ExpiredSignatureError:
        raise ApiError(401, "TOKEN_EXPIRED", "登录凭证已过期") from None
    except jwt.InvalidTokenError:
        raise ApiError(401, "UNAUTHENTICATED", "登录凭证无效") from None
    session = db.get(LoginSession, payload["sid"])
    if (
        not session
        or session.revoked_at
        or session.expires_at <= now()
        or session.user_id != payload["sub"]
    ):
        raise ApiError(401, "UNAUTHENTICATED", "会话已失效")
    request.state.session_id = session.id
    return db.get(User, session.user_id)


Auth = Annotated[User, Depends(current_user)]


def refresh(db, settings, token):
    token_hash = digest(token)
    record = db.get(RefreshToken, token_hash)
    if not record:
        raise ApiError(401, "UNAUTHENTICATED", "刷新凭证无效")
    session = db.scalar(
        select(LoginSession).where(LoginSession.id == record.session_id).with_for_update()
    )
    db.refresh(record)
    if session.revoked_at or session.expires_at <= now():
        raise ApiError(401, "UNAUTHENTICATED", "会话已失效")
    if record.used_at:
        session.revoked_at = now()
        # Persist replay revocation even though the request returns an error.
        db.commit()
        raise ApiError(401, "UNAUTHENTICATED", "刷新凭证已使用，请重新登录")
    record.used_at = now()
    return issue_tokens(db, settings, db.get(User, session.user_id), session)
