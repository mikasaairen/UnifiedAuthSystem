"""
用户增删改查
"""
from datetime import datetime, timedelta
from typing import Optional
from sqlalchemy.orm import Session
from app.core.security import get_password_hash, verify_password
from app.core.config import settings
from app.crud.base import CRUDBase, get_next_available_id
from app.models.user import User
from app.schemas.user import UserCreate, UserUpdate


class CRUDUser(CRUDBase[User, UserCreate, UserUpdate]):
    def get_by_username(self, db: Session, *, username: str) -> Optional[User]:
        """
        根据用户名获取用户
        """
        return db.query(User).filter(User.username == username).first()
    
    def get_by_email(self, db: Session, *, email: str) -> Optional[User]:
        """
        根据邮箱获取用户
        """
        return db.query(User).filter(User.email == email).first()
    
    def create(self, db: Session, *, obj_in: UserCreate) -> User:
        """
        创建用户。新用户复用已被删除用户的 id（从 1 起取最小可用 id）。
        """
        new_id = get_next_available_id(db, User)
        password = obj_in.password[:72]
        db_obj = User(
            id=new_id,
            username=obj_in.username,
            email=obj_in.email,
            hashed_password=get_password_hash(password),
            full_name=obj_in.full_name,
            is_active=True,
            is_admin=obj_in.is_admin if hasattr(obj_in, 'is_admin') else False
        )
        db.add(db_obj)
        db.commit()
        db.refresh(db_obj)
        return db_obj
    
    def authenticate(self, db: Session, *, username: str, password: str) -> Optional[User]:
        """
        验证用户凭据
        """
        user = self.get_by_username(db, username=username)
        if not user:
            return None
        # 账户锁定检查（防暴力破解）
        if user.locked_until and user.locked_until > datetime.utcnow():
            return None
        if not verify_password(password, user.hashed_password):
            user.failed_login_attempts = (user.failed_login_attempts or 0) + 1
            if user.failed_login_attempts >= settings.LOGIN_MAX_FAILS:
                user.locked_until = datetime.utcnow() + timedelta(minutes=settings.LOGIN_LOCK_MINUTES)
                user._just_locked = True
            db.add(user)
            db.commit()
            return None
        # 登录成功：清空失败计数与锁定
        user.failed_login_attempts = 0
        user.locked_until = None
        db.add(user)
        db.commit()
        db.refresh(user)
        return user
    
    def is_active(self, user: User) -> bool:
        """
        检查用户是否激活
        """
        return user.is_active
    
    def is_admin(self, user: User) -> bool:
        """
        检查用户是否为管理员
        """
        return user.is_admin


crud_user = CRUDUser(User)

