from typing import Optional
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from src.db.database import get_session
from src.db.models import User
from src.auth.jwt_utils import jwt_manager


# HTTP Bearer认证方案
security = HTTPBearer(auto_error=False)


async def get_current_user_optional(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: AsyncSession = Depends(get_session)
) -> Optional[User]:
    """
    获取当前用户（可选，允许未认证用户访问）

    Args:
        credentials: HTTP认证凭据
        db: 数据库会话

    Returns:
        当前用户对象，未认证返回None
    """
    if not credentials:
        return None

    # 验证令牌
    payload = jwt_manager.verify_token(credentials.credentials)
    if not payload:
        return None

    # 检查令牌类型
    if not jwt_manager.is_access_token(credentials.credentials):
        return None

    # 获取用户ID
    user_id = payload.get("sub")
    if not user_id:
        return None

    # 从数据库查询用户
    try:
        stmt = select(User).where(
            User.id == user_id,
            User.is_delete == False
        )
        result = await db.execute(stmt)
        user = result.scalar_one_or_none()
        return user
    except Exception:
        return None


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: AsyncSession = Depends(get_session)
) -> User:
    """
    获取当前用户（必需，用户必须已认证）

    Args:
        credentials: HTTP认证凭据
        db: 数据库会话

    Returns:
        当前用户对象

    Raises:
        HTTPException: 认证失败时抛出异常
    """
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="未提供认证令牌",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # 验证令牌
    payload = jwt_manager.verify_token(credentials.credentials)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="无效的认证令牌",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # 检查令牌类型
    if not jwt_manager.is_access_token(credentials.credentials):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="无效的令牌类型",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # 获取用户ID
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="令牌中缺少用户信息",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # 从数据库查询用户
    try:
        stmt = select(User).where(
            User.id == user_id,
            User.is_delete == False
        )
        result = await db.execute(stmt)
        user = result.scalar_one_or_none()

        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="用户不存在",
                headers={"WWW-Authenticate": "Bearer"},
            )

        return user
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="获取用户信息失败",
        )


async def get_current_active_user(
    current_user: User = Depends(get_current_user)
) -> User:
    """
    获取当前活跃用户（扩展用，暂时只是返回当前用户）

    Args:
        current_user: 当前用户

    Returns:
        当前活跃用户
    """
    # 这里可以添加用户状态检查逻辑
    # 例如：检查用户是否被禁用、是否需要邮箱验证等
    return current_user