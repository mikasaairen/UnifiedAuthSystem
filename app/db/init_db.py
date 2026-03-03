"""
[脚本] 初始化数据库、超级管理员和初始角色权限
"""
from sqlalchemy.orm import Session
from app.core.config import settings
from app.db.base import Base
from app.db.session import engine
from app.crud import crud_user
from app.crud.crud_rbac import crud_role, crud_permission, crud_resource
from app.schemas.user import UserCreate
from app.models.rbac import Role, Permission, Resource
from app.models.application import Application


def init_db(db: Session) -> None:
    """
    初始化数据库：创建表、超级管理员、初始角色和权限
    """
    # 创建所有表
    Base.metadata.create_all(bind=engine)
    
    # 创建超级管理员
    user = crud_user.get_by_username(db, username=settings.FIRST_SUPERUSER_USERNAME)
    if not user:
        user_in = UserCreate(
            username=settings.FIRST_SUPERUSER_USERNAME,
            email=settings.FIRST_SUPERUSER_EMAIL,
            password=settings.FIRST_SUPERUSER_PASSWORD,
            full_name="超级管理员",
            is_admin=True
        )
        user = crud_user.create(db, obj_in=user_in)
        print(f"✓ 创建超级管理员: {user.username}")
    else:
        print(f"✓ 超级管理员已存在: {user.username}")
    
    # 创建初始角色
    roles_data = [
        {"name": "admin", "description": "系统管理员"},
        {"name": "operator", "description": "操作员"},
        {"name": "user", "description": "普通用户"},
    ]
    
    for role_data in roles_data:
        role = crud_role.get_by_name(db, name=role_data["name"])
        if not role:
            role = crud_role.create(db, obj_in=role_data)
            print(f"✓ 创建角色: {role.name}")
        else:
            print(f"✓ 角色已存在: {role.name}")
    
    print("✓ 数据库初始化完成")


if __name__ == "__main__":
    from app.db.session import SessionLocal
    db = SessionLocal()
    try:
        init_db(db)
    finally:
        db.close()

