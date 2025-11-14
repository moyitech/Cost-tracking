from datetime import datetime, timedelta
from typing import Optional, Dict, Any
from jose import JWTError, jwt
from src.conf.env import settings


class JWTManager:
    """JWT工具类"""

    def __init__(self):
        self.secret_key = settings.SECRET_KEY
        self.algorithm = settings.ALGORITHM
        self.access_token_expire_minutes = settings.ACCESS_TOKEN_EXPIRE_MINUTES

    def create_access_token(
        self,
        data: Dict[str, Any],
        expires_delta: Optional[timedelta] = None
    ) -> str:
        """
        创建访问令牌

        Args:
            data: 要编码的数据
            expires_delta: 过期时间增量

        Returns:
            JWT令牌
        """
        to_encode = data.copy()

        if expires_delta:
            expire = datetime.utcnow() + expires_delta
        else:
            expire = datetime.utcnow() + timedelta(minutes=self.access_token_expire_minutes)

        to_encode.update({"exp": expire})
        to_encode.update({"type": "access"})

        return jwt.encode(to_encode, self.secret_key, algorithm=self.algorithm)

    def create_refresh_token(
        self,
        data: Dict[str, Any],
        expires_delta: Optional[timedelta] = None
    ) -> str:
        """
        创建刷新令牌

        Args:
            data: 要编码的数据
            expires_delta: 过期时间增量

        Returns:
            JWT刷新令牌
        """
        to_encode = data.copy()

        if expires_delta:
            expire = datetime.utcnow() + expires_delta
        else:
            expire = datetime.utcnow() + timedelta(minutes=settings.REFRESH_TOKEN_EXPIRE_MINUTES)

        to_encode.update({"exp": expire})
        to_encode.update({"type": "refresh"})

        return jwt.encode(to_encode, self.secret_key, algorithm=self.algorithm)

    def verify_token(self, token: str) -> Optional[Dict[str, Any]]:
        """
        验证令牌

        Args:
            token: JWT令牌

        Returns:
            解码后的数据，验证失败返回None
        """
        try:
            payload = jwt.decode(token, self.secret_key, algorithms=[self.algorithm])
            return payload
        except JWTError:
            return None

    def get_user_id_from_token(self, token: str) -> Optional[int]:
        """
        从令牌中获取用户ID

        Args:
            token: JWT令牌

        Returns:
            用户ID，验证失败返回None
        """
        payload = self.verify_token(token)
        if payload:
            return payload.get("sub")
        return None

    def is_access_token(self, token: str) -> bool:
        """
        检查是否为访问令牌

        Args:
            token: JWT令牌

        Returns:
            是否为访问令牌
        """
        payload = self.verify_token(token)
        if payload:
            return payload.get("type") == "access"
        return False

    def is_refresh_token(self, token: str) -> bool:
        """
        检查是否为刷新令牌

        Args:
            token: JWT令牌

        Returns:
            是否为刷新令牌
        """
        payload = self.verify_token(token)
        if payload:
            return payload.get("type") == "refresh"
        return False

    def generate_token_pair(self, user_id: int, user_info: Dict[str, Any]) -> Dict[str, str]:
        """
        生成令牌对

        Args:
            user_id: 用户ID
            user_info: 用户信息

        Returns:
            包含访问令牌和刷新令牌的字典
        """
        access_token = self.create_access_token({
            "sub": user_id,
            "openid": user_info.get("openid"),
            "nickname": user_info.get("nickname"),
            "avatar_url": user_info.get("avatar_url")
        })

        refresh_token = self.create_refresh_token({
            "sub": user_id
        })

        return {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "token_type": "bearer"
        }


# 全局JWT管理器实例
jwt_manager = JWTManager()