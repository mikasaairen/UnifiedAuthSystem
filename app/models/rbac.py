"""
RBAC 核心模型：
- Role（角色）
- Resource（受控资源：接口/功能等，属于某个应用）
- Permission（权限：绑定到某个资源，并用 code 作为全局唯一标识）

关系：
- User <-> Role（多对多）
- Role <-> Permission（多对多）
- Permission -> Resource（多对一）
"""

from sqlalchemy import Column, ForeignKey, Integer, String, Table, Text
from sqlalchemy.orm import relationship

from app.db.base import Base

# 用户-角色（多对多）
user_roles = Table(
    "user_roles",
    Base.metadata,
    Column("user_id", Integer, ForeignKey("users.id"), primary_key=True),
    Column("role_id", Integer, ForeignKey("roles.id"), primary_key=True),
)

# 角色-权限（多对多）
role_permissions = Table(
    "role_permissions",
    Base.metadata,
    Column("role_id", Integer, ForeignKey("roles.id"), primary_key=True),
    Column("permission_id", Integer, ForeignKey("permissions.id"), primary_key=True),
)


class Role(Base):
    """角色表"""

    __tablename__ = "roles"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(64), unique=True, index=True, nullable=False)
    description = Column(Text, nullable=True)

    permissions = relationship(
        "Permission",
        secondary=role_permissions,
        back_populates="roles",
        lazy="selectin",
    )
    users = relationship(
        "User",
        secondary=user_roles,
        back_populates="roles",
        lazy="selectin",
    )


class Resource(Base):
    """受控资源（接口/功能）"""

    __tablename__ = "resources"

    id = Column(Integer, primary_key=True, index=True)
    app_id = Column(Integer, ForeignKey("applications.id"), nullable=False, index=True)
    name = Column(String(128), nullable=False)
    resource_type = Column(String(32), nullable=False)  # api/ui/other
    path = Column(String(255), nullable=False, index=True)
    method = Column(String(16), nullable=True)  # GET/POST... 可选
    description = Column(Text, nullable=True)

    app = relationship("Application", back_populates="resources")
    permissions = relationship("Permission", back_populates="resource", cascade="all, delete-orphan")


class Permission(Base):
    """权限（细粒度，绑定资源）"""

    __tablename__ = "permissions"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(128), unique=True, index=True, nullable=False)  # 如 orders:read
    name = Column(String(128), nullable=False)
    resource_id = Column(Integer, ForeignKey("resources.id"), nullable=False, index=True)
    description = Column(Text, nullable=True)

    resource = relationship("Resource", back_populates="permissions")
    roles = relationship(
        "Role",
        secondary=role_permissions,
        back_populates="permissions",
        lazy="selectin",
    )

