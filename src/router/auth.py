from typing import Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from src.db.database import get_session
from src.db.models import User
from src.auth.jwt_utils import jwt_manager
from src.auth.dependencies import get_current_user
from src.utils.wechat import wechat_login_service
from src.utils.response import success_response, error_response
from src.utils.datetime_utils import calculate_daily_cost
from httpx import RequestError
import json

router = APIRouter(prefix="/api/auth", tags=["认证"])


# Pydantic模型
class WechatCallbackRequest(BaseModel):
    code: str
    state: str


class RefreshTokenRequest(BaseModel):
    refresh_token: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str
    user_info: Dict[str, Any]


@router.get("/wechat/qr")
async def get_wechat_qrcode():
    """
    获取微信登录二维码
    """
    try:
        qr_data = await wechat_login_service.generate_qrcode_url()

        # 生成二维码图片
        qr_image_base64 = wechat_login_service.generate_qrcode_image(qr_data["qr_url"])

        return success_response({
            "session_id": qr_data["session_id"],
            "qr_code": qr_image_base64,
            "expires_at": qr_data["expires_at"]
        }, "获取二维码成功")
    except Exception as e:
        return error_response(f"获取二维码失败: {str(e)}", "QR_CODE_ERROR")


@router.get("/wechat/status/{session_id}")
async def get_wechat_login_status(session_id: str):
    """
    查询微信登录状态
    """
    try:
        status_data = await wechat_login_service.get_session_status(session_id)
        return success_response(status_data, "查询状态成功")
    except Exception as e:
        return error_response(f"查询登录状态失败: {str(e)}", "STATUS_QUERY_ERROR")


@router.post("/wechat/callback")
async def wechat_callback(callback_data: WechatCallbackRequest, db: AsyncSession = Depends(get_session)):
    """
    微信登录回调处理
    """
    try:
        # 使用WechatLoginService获取用户信息
        user_data = await wechat_login_service.get_user_info_by_code(callback_data.code)

        if not user_data:
            return error_response("微信授权失败或获取用户信息失败", "WECHAT_AUTH_ERROR")

        openid = user_data["openid"]

        # 查找或创建用户
        stmt = select(User).where(
            User.openid == openid,
            User.is_delete == False
        )
        result = await db.execute(stmt)
        user = result.scalar_one_or_none()

        if not user:
            # 创建新用户
            user = User(
                openid=user_data["openid"],
                unionid=user_data.get("unionid"),
                nickname=user_data.get("nickname"),
                avatar_url=user_data.get("avatar_url")
            )
            db.add(user)
            await db.commit()
            await db.refresh(user)

        # 生成JWT令牌
        token_pair = jwt_manager.generate_token_pair(user.id, {
            "openid": user.openid,
            "nickname": user.nickname,
            "avatar_url": user.avatar_url
        })

        # 查找对应的会话并更新状态
        # 这里需要根据state来查找session_id，实际实现中可能需要调整
        session_id = callback_data.state  # 简化实现，实际应该根据state查找对应的session_id

        # 更新会话状态
        await wechat_login_service.update_session_status(
            session_id,
            "success",
            user_info={
                "openid": user.openid,
                "nickname": user.nickname,
                "avatar_url": user.avatar_url
            },
            token=token_pair["access_token"]
        )

        return success_response(token_pair, "登录成功")

    except RequestError as e:
        return error_response(f"微信接口请求失败: {str(e)}", "WECHAT_REQUEST_ERROR")
    except Exception as e:
        return error_response(f"处理微信回调失败: {str(e)}", "CALLBACK_PROCESS_ERROR")


@router.post("/refresh")
async def refresh_token(request_data: RefreshTokenRequest, db: AsyncSession = Depends(get_session)):
    """
    刷新访问令牌
    """
    try:
        refresh_token = request_data.refresh_token

        # 验证刷新令牌
        payload = jwt_manager.verify_token(refresh_token)
        if not payload:
            return error_response("无效的刷新令牌", "INVALID_REFRESH_TOKEN")

        # 检查令牌类型
        if not jwt_manager.is_refresh_token(refresh_token):
            return error_response("令牌类型错误", "WRONG_TOKEN_TYPE")

        # 获取用户ID
        user_id = payload.get("sub")
        if not user_id:
            return error_response("令牌中缺少用户信息", "MISSING_USER_INFO")

        # 查询用户
        stmt = select(User).where(
            User.id == user_id,
            User.is_delete == False
        )
        result = await db.execute(stmt)
        user = result.scalar_one_or_none()

        if not user:
            return error_response("用户不存在", "USER_NOT_FOUND")

        # 生成新的令牌对
        token_pair = jwt_manager.generate_token_pair(user.id, {
            "openid": user.openid,
            "nickname": user.nickname,
            "avatar_url": user.avatar_url
        })

        return success_response(token_pair, "令牌刷新成功")

    except Exception as e:
        return error_response(f"刷新令牌失败: {str(e)}", "TOKEN_REFRESH_ERROR")


@router.post("/logout")
async def logout(current_user: User = Depends(get_current_user)):
    """
    用户登出
    """
    try:
        # 在实际应用中，可以将令牌加入黑名单
        # 这里简单返回成功消息
        return success_response(None, "登出成功")
    except Exception as e:
        return error_response(f"登出失败: {str(e)}", "LOGOUT_ERROR")


@router.get("/me")
async def get_current_user_info(current_user: User = Depends(get_current_user)):
    """
    获取当前用户信息
    """
    try:
        user_info = {
            "id": current_user.id,
            "openid": current_user.openid,
            "nickname": current_user.nickname,
            "avatar_url": current_user.avatar_url,
            "created_at": current_user.created_at.isoformat() if current_user.created_at else None,
            "updated_at": current_user.updated_at.isoformat() if current_user.updated_at else None
        }

        return success_response(user_info, "获取用户信息成功")
    except Exception as e:
        return error_response(f"获取用户信息失败: {str(e)}", "GET_USER_INFO_ERROR")