import enum

from sqlalchemy import Enum, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class PermissionEffect(str, enum.Enum):
    allow = "allow"
    deny = "deny"


class Permission(Base):
    __tablename__ = "permissions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    description: Mapped[str] = mapped_column(String(255), nullable=False)

    user_links: Mapped[list["UserPermission"]] = relationship("UserPermission", back_populates="permission")


class UserPermission(Base):
    __tablename__ = "user_permissions"
    __table_args__ = (UniqueConstraint("user_id", "permission_id", name="uq_user_permission"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    permission_id: Mapped[int] = mapped_column(ForeignKey("permissions.id", ondelete="CASCADE"), nullable=False)
    effect: Mapped[PermissionEffect] = mapped_column(
        Enum(PermissionEffect), nullable=False, default=PermissionEffect.allow
    )

    user: Mapped["User"] = relationship("User", back_populates="extra_permissions")
    permission: Mapped["Permission"] = relationship("Permission", back_populates="user_links")
