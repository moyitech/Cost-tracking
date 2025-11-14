import json
import uuid
import qrcode
import io
import base64
from datetime import datetime, timedelta
from typing import Dict, Any, Optional
from src.conf.env import settings
import src.db.redis_client as redis
from loguru import logger

class WechatLoginService:
    """微信登录服务"""

    def __init__(self):
        self.app_id = settings.WX_APPID
        self.app_secret = settings.WX_APPSECRET
        self.redirect_uri = settings.WX_REDIRECT_URI
        self.session_expire_minutes = 5  # 二维码5分钟过期
        self.access_token_expire_minutes = 110  # access_token 有效期约2小时，提前10分钟刷新

    async def generate_qrcode_url(self) -> Dict[str, Any]:
        """
        生成微信登录二维码URL

        Returns:
            包含二维码URL和会话ID的字典
        """
        session_id = str(uuid.uuid4())
        state = str(uuid.uuid4())

        # 构建微信授权URL
        # 注意：这里使用微信开放平台的授权URL，不是公众号的
        from urllib.parse import quote, quote_plus
        auth_url = (
            f"https://open.weixin.qq.com/connect/qrconnect"
            f"?appid={self.app_id}"
            f"&redirect_uri={quote_plus(self.redirect_uri)}"
            f"&response_type=code"
            f"&scope=snsapi_login"
            f"&state={state}#wechat_redirect"
        )

        logger.debug(f"Generated WeChat QR Code URL: {auth_url} for session {session_id}")

        # 将会话信息存储到Redis
        session_data = {
            "session_id": session_id,
            "state": state,
            "status": "pending",
            "created_at": datetime.now().isoformat(),
            "expires_at": (datetime.now() + timedelta(minutes=self.session_expire_minutes)).isoformat()
        }

        await redis.client.setex(
            f"wechat_session:{session_id}",
            self.session_expire_minutes * 60,
            json.dumps(session_data)
        )

        return {
            "session_id": session_id,
            "qr_url": auth_url,
            "expires_at": session_data["expires_at"]
        }

    def generate_qrcode_image(self, qr_url: str) -> str:
        """
        生成二维码图片的base64字符串

        Args:
            qr_url: 二维码URL

        Returns:
            base64编码的图片字符串
        """
        qr = qrcode.QRCode(
            version=1,
            error_correction=qrcode.constants.ERROR_CORRECT_L,
            box_size=10,
            border=4,
        )
        qr.add_data(qr_url)
        qr.make(fit=True)

        img = qr.make_image(fill_color="black", back_color="white")

        # 将图片转换为base64
        buffer = io.BytesIO()
        img.save(buffer, format='PNG')
        img_str = base64.b64encode(buffer.getvalue()).decode()

        return f"data:image/png;base64,{img_str}"

    async def get_session_status(self, session_id: str) -> Dict[str, Any]:
        """
        获取会话状态

        Args:
            session_id: 会话ID

        Returns:
            会话状态信息
        """
        session_data = await redis.client.get(f"wechat_session:{session_id}")

        if not session_data:
            return {
                "status": "expired",
                "message": "会话已过期"
            }

        try:
            data = json.loads(session_data)

            # 检查是否过期
            expires_at = datetime.fromisoformat(data["expires_at"])
            if datetime.now() > expires_at:
                return {
                    "status": "expired",
                    "message": "会话已过期"
                }

            return {
                "status": data["status"],
                "message": self._get_status_message(data["status"]),
                "user_info": data.get("user_info"),
                "token": data.get("token")
            }
        except (json.JSONDecodeError, ValueError, KeyError):
            return {
                "status": "error",
                "message": "会话数据错误"
            }

    async def update_session_status(self, session_id: str, status: str, **kwargs) -> bool:
        """
        更新会话状态

        Args:
            session_id: 会话ID
            status: 新状态
            **kwargs: 其他要更新的数据

        Returns:
            是否更新成功
        """
        session_data = await redis.client.get(f"wechat_session:{session_id}")

        if not session_data:
            return False

        try:
            data = json.loads(session_data)
            data["status"] = status
            data.update(kwargs)

            # 更新Redis中的数据
            await redis.client.setex(
                f"wechat_session:{session_id}",
                self.session_expire_minutes * 60,
                json.dumps(data)
            )
            return True
        except (json.JSONDecodeError, ValueError):
            return False

    async def get_access_token(self) -> Optional[str]:
        """
        获取微信 access_token，带缓存机制

        Returns:
            access_token 或 None
        """
        # 先从缓存获取
        cache_key = "wechat_access_token"
        cached_token = await redis.client.get(cache_key)

        if cached_token:
            try:
                token_data = json.loads(cached_token)
                return token_data.get("access_token")
            except (json.JSONDecodeError, KeyError):
                pass

        # 缓存不存在或无效，重新获取
        return await self._refresh_access_token()

    async def _refresh_access_token(self) -> Optional[str]:
        """
        刷新 access_token

        Returns:
            新的 access_token 或 None
        """
        import httpx

        url = "https://api.weixin.qq.com/cgi-bin/token"
        params = {
            "grant_type": "client_credential",
            "appid": self.app_id,
            "secret": self.app_secret
        }

        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(url, params=params)
                data = response.json()

                if "access_token" in data:
                    access_token = data["access_token"]
                    expires_in = data.get("expires_in", 7200)  # 默认2小时

                    # 缓存 access_token，实际过期时间减去10分钟缓冲
                    cache_expire = min(
                        self.access_token_expire_minutes * 60,
                        expires_in - 600  # 提前10分钟过期
                    )

                    token_data = {
                        "access_token": access_token,
                        "expires_in": expires_in,
                        "created_at": datetime.now().isoformat()
                    }

                    cache_key = "wechat_access_token"
                    await redis.client.setex(
                        cache_key,
                        cache_expire,
                        json.dumps(token_data)
                    )

                    return access_token
                else:
                    # 获取失败，记录错误
                    error_msg = data.get("errmsg", "未知错误")
                    print(f"获取微信 access_token 失败: {error_msg}")
                    return None

        except Exception as e:
            print(f"刷新 access_token 时发生异常: {str(e)}")
            return None

    async def get_user_info_by_code(self, code: str) -> Optional[Dict[str, Any]]:
        """
        通过授权码获取用户信息

        Args:
            code: 微信授权码

        Returns:
            用户信息字典或 None
        """
        import httpx

        # 第一步：通过code获取用户的access_token
        token_url = "https://api.weixin.qq.com/sns/oauth2/access_token"
        token_params = {
            "appid": self.app_id,
            "secret": self.app_secret,
            "code": code,
            "grant_type": "authorization_code"
        }

        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(token_url, params=token_params)
                token_data = response.json()

                if "errcode" in token_data:
                    error_msg = token_data.get("errmsg", "未知错误")
                    print(f"获取用户access_token失败: {error_msg}")
                    return None

                user_access_token = token_data.get("access_token")
                openid = token_data.get("openid")

                # 第二步：使用用户access_token获取用户信息
                user_info_url = "https://api.weixin.qq.com/sns/userinfo"
                user_info_params = {
                    "access_token": user_access_token,
                    "openid": openid
                }

                user_response = await client.get(user_info_url, params=user_info_params)
                user_data = user_response.json()

                if "errcode" not in user_data:
                    return {
                        "openid": user_data.get("openid"),
                        "nickname": user_data.get("nickname"),
                        "avatar_url": user_data.get("headimgurl"),
                        "unionid": user_data.get("unionid"),
                        "sex": user_data.get("sex"),
                        "province": user_data.get("province"),
                        "city": user_data.get("city"),
                        "country": user_data.get("country")
                    }
                else:
                    error_msg = user_data.get("errmsg", "未知错误")
                    print(f"获取用户信息失败: {error_msg}")
                    return None

        except Exception as e:
            print(f"获取用户信息时发生异常: {str(e)}")
            return None

    async def validate_access_token(self) -> bool:
        """
        验证缓存的 access_token 是否有效

        Returns:
            True if valid, False otherwise
        """
        cache_key = "wechat_access_token"
        cached_token = await redis.client.get(cache_key)

        if not cached_token:
            return False

        try:
            token_data = json.loads(cached_token)
            # 简单检查是否有 access_token
            return "access_token" in token_data
        except (json.JSONDecodeError, KeyError):
            return False

    async def get_cached_token_info(self) -> Optional[Dict[str, Any]]:
        """
        获取缓存的 token 信息

        Returns:
            Token info dict or None
        """
        cache_key = "wechat_access_token"
        cached_token = await redis.client.get(cache_key)

        if not cached_token:
            return None

        try:
            return json.loads(cached_token)
        except (json.JSONDecodeError, KeyError):
            return None

    async def clear_access_token_cache(self):
        """清除 access_token 缓存"""
        cache_key = "wechat_access_token"
        await redis.client.delete(cache_key)

    def _get_status_message(self, status: str) -> str:
        """获取状态消息"""
        status_messages = {
            "pending": "等待用户扫码",
            "scanned": "用户已扫码，等待确认",
            "confirmed": "用户已确认",
            "success": "登录成功",
            "failed": "登录失败",
            "cancelled": "用户取消"
        }
        return status_messages.get(status, "未知状态")

    def cleanup_expired_sessions(self) -> int:
        """
        清理过期的会话

        Returns:
            清理的会话数量
        """
        # 这里可以通过扫描Redis来清理过期会话
        # 实际项目中可以定期调用这个方法
        pass


# 全局微信登录服务实例
wechat_login_service = WechatLoginService()