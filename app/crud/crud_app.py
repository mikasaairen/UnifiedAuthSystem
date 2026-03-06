"""
应用信息查询和管理
"""
from typing import Optional, List
from sqlalchemy.orm import Session
from app.crud.base import CRUDBase, get_next_available_id
from app.models.application import Application
from app.models.user import User
from app.core.security import get_password_hash, verify_password
from app.schemas.application import ApplicationCreate, ApplicationUpdate


class CRUDApp(CRUDBase[Application, ApplicationCreate, ApplicationUpdate]):
    def get_multi(
        self, db: Session, *, skip: int = 0, limit: int = 100
    ) -> List[Application]:
        return (
            db.query(Application)
            .order_by(Application.id)
            .offset(skip)
            .limit(limit)
            .all()
        )

    def get_by_app_id(self, db: Session, *, app_id: str) -> Optional[Application]:
        """
        根据应用ID获取应用
        """
        return db.query(Application).filter(Application.app_id == app_id).first()
    
    def create(self, db: Session, *, obj_in: ApplicationCreate) -> Application:
        """
        创建应用（自动生成 app_id 和 app_secret，并哈希存储 secret）。
        新应用复用已被删除应用的 id（从 1 起取最小可用 id）。
        """
        import secrets
        app_id = obj_in.app_id if obj_in.app_id else secrets.token_urlsafe(16)
        app_secret = obj_in.app_secret if obj_in.app_secret else secrets.token_urlsafe(32)
        new_id = get_next_available_id(db, Application)
        db_obj = Application(
            id=new_id,
            app_id=app_id,
            app_name=obj_in.app_name,
            description=obj_in.description,
            app_secret_hash=get_password_hash(app_secret),
            status="pending",
            is_active=False,
            callback_url=obj_in.callback_url
        )
        db.add(db_obj)
        db.commit()
        db.refresh(db_obj)
        return db_obj
    
    def verify_app_secret(self, db: Session, *, app_id: str, app_secret: str) -> bool:
        """
        验证应用的 app_secret（系统级身份校验）
        """
        app = self.get_by_app_id(db, app_id=app_id)
        if not app:
            return False
        if app.status != "active":
            return False
        return verify_password(app_secret, app.app_secret_hash)
    
    def check_user_permission(
        self, db: Session, *, user_id: int, app_id: str, permission_code: str
    ) -> bool:
        """
        检查用户对应用的权限（基于 RBAC）
        """
        # 获取应用
        app = self.get_by_app_id(db, app_id=app_id)
        if not app or app.status != "active":
            return False
        
        # 获取用户
        user = db.query(User).filter(User.id == user_id).first()
        if not user or not user.is_active:
            return False
        
        from app.crud.crud_rbac import crud_role
        return crud_role.check_user_permission(
            db, user_id=user_id, permission_code=permission_code
        )
    
    def get_user_apps(self, db: Session, *, user_id: int) -> List[Application]:
        """
        获取用户可访问的应用列表（基于 RBAC）
        """
        user = db.query(User).filter(User.id == user_id).first()
        if not user or not user.is_active:
            return []
        from app.crud.crud_rbac import crud_role
        from app.models.rbac import Permission, Resource
        
        permissions = crud_role.get_user_permissions(db, user_id=user_id)
        if not permissions:
            return []
        
        # 获取权限关联的资源，再获取资源关联的应用
        resource_ids = [p.resource_id for p in permissions]
        resources = db.query(Resource).filter(Resource.id.in_(resource_ids)).all()
        app_ids = list(set([r.app_id for r in resources]))
        
        if not app_ids:
            return []
        
        return db.query(Application).filter(
            Application.id.in_(app_ids),
            Application.status == "active"
        ).all()
    
    def update_status(
        self, db: Session, *, app_id: str, status: str
    ) -> Optional[Application]:
        """
        更新应用状态（pending/active/disabled）
        """
        app = self.get_by_app_id(db, app_id=app_id)
        if not app:
            return None
        
        app.status = status
        app.is_active = (status == "active")
        db.add(app)
        db.commit()
        db.refresh(app)
        return app


crud_app = CRUDApp(Application)

