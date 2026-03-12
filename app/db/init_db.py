"""
[脚本] 初始化数据库、超级管理员、初始角色与 RBAC 受控资源/权限
"""
from sqlalchemy.orm import Session
from app.core.config import settings
from app.core.security import get_password_hash
from app.db.base import Base
from app.db.session import engine
from app.crud import crud_user
from app.crud.crud_rbac import crud_role, crud_permission, crud_resource
from app.schemas.user import UserCreate
from app.models.rbac import Role, Permission, Resource
from app.models.application import Application
from app.models.user import User


# 系统管理端应用 app_id，用于归属管理端受控资源
SYSTEM_APP_ID = "__system__"

# 管理端受控资源与权限（细粒度：按模块）
RBAC_SYSTEM_RESOURCES = [
    {"name": "用户管理", "path": "/api/v1/users", "method": None, "description": "用户列表、创建、修改、禁用等"},
    {"name": "角色权限管理", "path": "/api/v1/rbac", "method": None, "description": "角色、权限、资源及分配"},
    {"name": "应用管理", "path": "/api/v1/apps", "method": None, "description": "应用注册、审核、列表等"},
    {"name": "审计日志", "path": "/api/v1/logs", "method": None, "description": "审计日志查询与导出"},
    {"name": "系统设置", "path": "/api/v1/system", "method": None, "description": "系统设置、安全概览等"},
]
RBAC_SYSTEM_PERMISSIONS = [
    ("users:manage", "用户管理"),
    ("rbac:manage", "角色权限管理"),
    ("apps:manage", "应用管理"),
    ("logs:view", "审计日志"),
    ("system:manage", "系统设置"),
]


def seed_rbac_system(db: Session) -> None:
    """
    初始化 RBAC 受控资源与权限：系统管理端应用、资源、权限、并为 admin 角色分配权限。
    实现用户-角色-权限-资源映射，供细粒度访问控制使用。
    """
    # 1) 系统管理端应用（用于归属管理端资源）
    sys_app = db.query(Application).filter(Application.app_id == SYSTEM_APP_ID).first()
    if not sys_app:
        sys_app = Application(
            app_id=SYSTEM_APP_ID,
            app_name="系统管理端",
            description="管理端受控资源归属，用于 RBAC 资源分组",
            app_secret_hash=get_password_hash("__system_secret__"),
            status="active",
            is_active=True,
            callback_url=None,
        )
        db.add(sys_app)
        db.commit()
        db.refresh(sys_app)
        print("✓ 创建系统管理端应用（RBAC 资源归属）")
    app_id = sys_app.id

    # 2) 受控资源（与上面常量一一对应）
    for res in RBAC_SYSTEM_RESOURCES:
        existing = db.query(Resource).filter(
            Resource.app_id == app_id,
            Resource.path == res["path"],
        ).first()
        if not existing:
            crud_resource.create(
                db,
                obj_in={
                    "app_id": app_id,
                    "name": res["name"],
                    "resource_type": "api",
                    "path": res["path"],
                    "method": res.get("method"),
                    "description": res.get("description"),
                },
            )
            print(f"✓ 创建资源: {res['name']} ({res['path']})")

    # 3) 权限（与资源一一对应，code 用于接口校验）
    permission_ids = []
    for (code, name), res in zip(RBAC_SYSTEM_PERMISSIONS, RBAC_SYSTEM_RESOURCES):
        path = res["path"]
        r = db.query(Resource).filter(Resource.app_id == app_id, Resource.path == path).first()
        if not r:
            continue
        existing = crud_permission.get_by_code(db, code=code)
        if not existing:
            p = crud_permission.create(
                db,
                obj_in={
                    "code": code,
                    "name": name,
                    "resource_id": r.id,
                    "description": f"访问资源: {path}",
                },
            )
            permission_ids.append(p.id)
            print(f"✓ 创建权限: {code} ({name})")
        else:
            permission_ids.append(existing.id)

    # 4) 为 admin 角色分配上述权限
    admin_role = crud_role.get_by_name(db, name="admin")
    if admin_role and permission_ids:
        admin_role = crud_role.assign_permissions(
            db, role_id=admin_role.id, permission_ids=permission_ids
        )
        print("✓ 已为 admin 角色分配管理端权限（细粒度）")


def _migrate_approved_at():
    """为已有 users 表添加 approved_at 列，并将现有用户设为已审核"""
    from sqlalchemy import inspect, text
    inspector = inspect(engine)
    try:
        columns = [c["name"] for c in inspector.get_columns("users")]
    except Exception:
        return
    if "approved_at" in columns:
        return
    with engine.connect() as conn:
        conn.execute(text("ALTER TABLE users ADD COLUMN approved_at DATETIME NULL"))
        conn.commit()
    # 现有用户设为已审核（出现在用户管理）
    with engine.connect() as conn:
        conn.execute(text("UPDATE users SET approved_at = COALESCE(created_at, NOW()) WHERE approved_at IS NULL"))
        conn.commit()
    print("✓ 已添加 approved_at 列并迁移现有用户")


def init_db(db: Session) -> None:
    """
    初始化数据库：创建表、超级管理员、初始角色、RBAC 资源与权限
    """
    # 创建所有表
    Base.metadata.create_all(bind=engine)
    _migrate_approved_at()

    # 创建超级管理员
    user = crud_user.get_by_username(db, username=settings.FIRST_SUPERUSER_USERNAME)
    if not user:
        user_in = UserCreate(
            username=settings.FIRST_SUPERUSER_USERNAME,
            email=settings.FIRST_SUPERUSER_EMAIL,
            password=settings.FIRST_SUPERUSER_PASSWORD,
            full_name="超级管理员",
            is_admin=True,
        )
        user = crud_user.create(db, obj_in=user_in)
        from datetime import datetime
        user.approved_at = datetime.utcnow()
        db.add(user)
        db.commit()
        db.refresh(user)
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

    # RBAC：系统管理端资源、权限及 admin 角色权限分配
    seed_rbac_system(db)

    # 为 admin 补齐已接入应用的访问权限（app:xxx:access）
    admin_role = crud_role.get_by_name(db, name="admin")
    if admin_role:
        for app in db.query(Application).filter(
            Application.status == "active",
            Application.app_id != SYSTEM_APP_ID,
        ).all():
            code = f"app:{app.app_id}:access"
            perm = crud_permission.get_by_code(db, code=code)
            if perm and perm.id not in [p.id for p in admin_role.permissions]:
                crud_role.assign_permissions(
                    db,
                    role_id=admin_role.id,
                    permission_ids=[p.id for p in admin_role.permissions] + [perm.id],
                )
                print(f"✓ admin 已补充分配应用访问权限：{app.app_name}")

    # 迁移：原有 is_admin 用户归为 admin 角色，其余归为 user 角色（彻底只用角色）
    admin_role = crud_role.get_by_name(db, name="admin")
    user_role = crud_role.get_by_name(db, name="user")
    if admin_role and user_role:
        for u in db.query(User).all():
            current_ids = [r.id for r in u.roles]
            if u.is_admin:
                if admin_role.id not in current_ids:
                    crud_role.assign_to_user(db, user_id=u.id, role_ids=current_ids + [admin_role.id])
                    print(f"✓ 用户 {u.username} 已归入 admin 角色")
            else:
                if user_role.id not in current_ids:
                    crud_role.assign_to_user(db, user_id=u.id, role_ids=current_ids + [user_role.id])
                    print(f"✓ 用户 {u.username} 已归入 user 角色")
        for u in db.query(User).all():
            u.is_admin = False
        db.commit()
        print("✓ 已将所有用户 is_admin 置为 False，权限仅由角色决定")

    print("✓ 数据库初始化完成")


if __name__ == "__main__":
    from app.db.session import SessionLocal
    db = SessionLocal()
    try:
        init_db(db)
    finally:
        db.close()

