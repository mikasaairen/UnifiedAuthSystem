"""
用户增删改查

说明：登录失败次数与按 (username,ip) 的锁定由 app.core.login_fail_store 与登录接口处理，
此处仅做凭据校验与管理员设置的 locked_until 检查。
"""
from datetime import datetime
from typing import Optional
from sqlalchemy.orm import Session
from app.core.security import get_password_hash, verify_password
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
        验证用户凭据。登录失败次数与 (username,ip) 锁定由 login_fail_store 在登录接口中处理。
        """
        user = self.get_by_username(db, username=username)
        if not user:
            return None
        if not user.is_active:
            return None
        # 管理员设置的按时长锁定（如禁用 15 分钟）
        if user.locked_until and user.locked_until > datetime.utcnow():
            return None
        if not verify_password(password, user.hashed_password):
            return None
        # 登录成功：清空用户表上的失败计数与锁定（兼容历史/管理员操作）
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

