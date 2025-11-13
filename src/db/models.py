from sqlalchemy import Column, String, Text, Integer, Boolean, DateTime, DECIMAL, Date
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.sql import func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship

Base = declarative_base()


class TimestampMixin:
    """提供自动时间戳功能的混入类"""
    created_at = Column(DateTime(timezone=True), nullable=False, default=func.now(), comment='创建时间')
    updated_at = Column(DateTime(timezone=True), nullable=False, default=func.now(), onupdate=func.now(), comment='更新时间')


class SoftDeleteMixin:
    """提供软删除功能的混入类"""
    is_delete = Column(Boolean, nullable=False, default=False, comment='是否删除')


class User(Base, TimestampMixin, SoftDeleteMixin):
    """用户表 - 通过微信登录创建的用户信息"""
    __tablename__ = 'users'

    id = Column(Integer, primary_key=True, autoincrement=True, comment='用户ID')
    openid = Column(String(128), unique=True, nullable=False, comment='微信openid')
    # unionid 只在需要跨应用用户识别时使用，一般情况下为空
    unionid = Column(String(128), nullable=True, comment='微信unionid（跨应用用户识别）')
    nickname = Column(String(255), nullable=True, comment='用户昵称')
    avatar_url = Column(Text, nullable=True, comment='头像URL')

    # 关系
    items = relationship("Item", back_populates="user", lazy="dynamic")
    preferences = relationship("UserPreference", back_populates="user", uselist=False)

    def __repr__(self):
        return f"<User(id={self.id}, openid={self.openid}, nickname={self.nickname})>"


class Item(Base, TimestampMixin, SoftDeleteMixin):
    """物品表 - 存储用户添加的物品记录"""
    __tablename__ = 'items'

    id = Column(Integer, primary_key=True, autoincrement=True, comment='物品ID')
    user_id = Column(Integer, nullable=False, comment='用户ID')
    name = Column(String(255), nullable=False, comment='物品名称')
    purchase_date = Column(Date, nullable=False, comment='购买日期')
    purchase_amount = Column(DECIMAL(10, 2), nullable=False, comment='购买金额')
    daily_cost = Column(DECIMAL(10, 4), nullable=False, comment='日均成本',
                       server_default='0.0000')

    # 关系
    user = relationship("User", back_populates="items")

    def __repr__(self):
        return f"<Item(id={self.id}, user_id={self.user_id}, name={self.name})>"


class UserPreference(Base, TimestampMixin, SoftDeleteMixin):
    """用户配置表 - 存储用户偏好设置（预留扩展）"""
    __tablename__ = 'user_preferences'

    id = Column(Integer, primary_key=True, autoincrement=True, comment='配置ID')
    user_id = Column(Integer, unique=True, nullable=False, comment='用户ID')

    # 关系
    user = relationship("User", back_populates="preferences")

    def __repr__(self):
        return f"<UserPreference(id={self.id}, user_id={self.user_id})>"


class WechatSession(Base, TimestampMixin, SoftDeleteMixin):
    """微信登录会话表 - 临时存储微信登录会话"""
    __tablename__ = 'wechat_sessions'

    id = Column(Integer, primary_key=True, autoincrement=True, comment='会话ID')
    session_id = Column(String(128), unique=True, nullable=False, comment='会话ID')
    state = Column(String(128), nullable=False, comment='状态参数')
    user_info = Column(JSONB, nullable=True, comment='微信用户信息')
    status = Column(String(20), nullable=False, default='pending', comment='会话状态')
    expires_at = Column(DateTime(timezone=True), nullable=False, comment='过期时间')

    def __repr__(self):
        return f"<WechatSession(id={self.id}, session_id={self.session_id}, status={self.status})>"


