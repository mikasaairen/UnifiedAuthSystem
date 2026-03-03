"""
会话（refresh token）CRUD
"""

from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session as OrmSession

from app.crud.base import CRUDBase
from app.models.session import Session


class CRUDSession(CRUDBase[Session, None, None]):
    def get_by_jti(self, db: OrmSession, *, jti: str) -> Optional[Session]:
        return db.query(Session).filter(Session.jti == jti).first()

    def get_by_user_id(self, db: OrmSession, *, user_id: int):
        return db.query(Session).filter(Session.user_id == user_id).order_by(Session.created_at.desc()).all()

    def revoke(self, db: OrmSession, *, db_obj: Session) -> Session:
        db_obj.revoked_at = datetime.utcnow()
        db.add(db_obj)
        db.commit()
        db.refresh(db_obj)
        return db_obj

    def is_active(self, db_obj: Session) -> bool:
        if db_obj.revoked_at is not None:
            return False
        return db_obj.expires_at > datetime.utcnow()


crud_session = CRUDSession(Session)

