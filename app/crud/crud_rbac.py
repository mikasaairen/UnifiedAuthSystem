"""
RBAC 相关 CRUD：角色、权限、资源管理
"""
from typing import Optional, List, Any
from sqlalchemy.orm import Session
from sqlalchemy import and_
from fastapi.encoders import jsonable_encoder

from app.crud.base import CRUDBase, get_next_available_id
from app.models.rbac import Role, Permission, Resource
from app.models.user import User


class CRUDRole(CRUDBase[Role, None, None]):
    def create(self, db: Session, *, obj_in: Any) -> Role:
        """创建角色，id 复用已删除记录的 id。"""
        next_id = get_next_available_id(db, Role)
        data = jsonable_encoder(obj_in)
        data["id"] = next_id
        db_obj = Role(**data)
        db.add(db_obj)
        db.commit()
        db.refresh(db_obj)
        return db_obj

    def get_by_name(self, db: Session, *, name: str) -> Optional[Role]:
        """根据角色名称获取角色"""
        return db.query(Role).filter(Role.name == name).first()
    
    def assign_permissions(
        self, db: Session, *, role_id: int, permission_ids: List[int]
    ) -> Role:
        """为角色分配权限"""
        role = self.get(db, id=role_id)
        if not role:
            raise ValueError(f"角色 {role_id} 不存在")
        
        permissions = db.query(Permission).filter(Permission.id.in_(permission_ids)).all()
        role.permissions = permissions
        db.commit()
        db.refresh(role)
        return role
    
    def assign_to_user(
        self, db: Session, *, user_id: int, role_ids: List[int]
    ) -> User:
        """为用户分配角色"""
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise ValueError(f"用户 {user_id} 不存在")
        
        roles = db.query(Role).filter(Role.id.in_(role_ids)).all()
        user.roles = roles
        db.commit()
        db.refresh(user)
        return user
    
    def get_user_permissions(self, db: Session, *, user_id: int) -> List[Permission]:
        """获取用户的所有权限（通过角色）"""
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            return []
        
        # 管理员拥有所有权限
        if user.is_admin:
            return db.query(Permission).all()
        
        # 通过角色获取权限
        permissions = set()
        for role in user.roles:
            for perm in role.permissions:
                permissions.add(perm)
        
        return list(permissions)
    
    def check_user_permission(
        self, db: Session, *, user_id: int, permission_code: str
    ) -> bool:
        """检查用户是否拥有指定权限"""
        user = db.query(User).filter(User.id == user_id).first()
        if not user or not user.is_active:
            return False
        
        # 管理员拥有所有权限
        if user.is_admin:
            return True
        
        # 检查用户角色是否拥有该权限
        for role in user.roles:
            for perm in role.permissions:
                if perm.code == permission_code:
                    return True
        
        return False


class CRUDPermission(CRUDBase[Permission, None, None]):
    def create(self, db: Session, *, obj_in: Any) -> Permission:
        """创建权限，id 复用已删除记录的 id。"""
        next_id = get_next_available_id(db, Permission)
        data = jsonable_encoder(obj_in)
        data["id"] = next_id
        db_obj = Permission(**data)
        db.add(db_obj)
        db.commit()
        db.refresh(db_obj)
        return db_obj

    def get_by_code(self, db: Session, *, code: str) -> Optional[Permission]:
        """根据权限代码获取权限"""
        return db.query(Permission).filter(Permission.code == code).first()
    
    def get_by_resource(
        self, db: Session, *, resource_id: int
    ) -> List[Permission]:
        """获取资源的所有权限"""
        return db.query(Permission).filter(Permission.resource_id == resource_id).all()


class CRUDResource(CRUDBase[Resource, None, None]):
    def create(self, db: Session, *, obj_in: Any) -> Resource:
        """创建资源，id 复用已删除记录的 id。"""
        next_id = get_next_available_id(db, Resource)
        data = jsonable_encoder(obj_in)
        data["id"] = next_id
        db_obj = Resource(**data)
        db.add(db_obj)
        db.commit()
        db.refresh(db_obj)
        return db_obj

    def get_by_app(
        self, db: Session, *, app_id: int
    ) -> List[Resource]:
        """获取应用的所有资源"""
        return db.query(Resource).filter(Resource.app_id == app_id).all()
    
    def get_by_path(
        self, db: Session, *, path: str, method: Optional[str] = None
    ) -> Optional[Resource]:
        """根据路径和方法获取资源"""
        query = db.query(Resource).filter(Resource.path == path)
        if method:
            query = query.filter(Resource.method == method)
        return query.first()


crud_role = CRUDRole(Role)
crud_permission = CRUDPermission(Permission)
crud_resource = CRUDResource(Resource)
