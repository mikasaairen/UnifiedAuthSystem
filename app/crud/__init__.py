# CRUD Package
# 导入 CRUD 实例（不是模块）
from app.crud.crud_user import crud_user
from app.crud.crud_app import crud_app
from app.crud.crud_audit import crud_audit
from app.crud.crud_session import crud_session
from app.crud.crud_rbac import crud_role, crud_permission, crud_resource

# 为了向后兼容，也导出模块（不推荐使用）
import app.crud.crud_user as crud_user_module
import app.crud.crud_app as crud_app_module
import app.crud.crud_audit as crud_audit_module
import app.crud.crud_session as crud_session_module
import app.crud.crud_rbac as crud_rbac_module

