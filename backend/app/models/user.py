import enum

from sqlalchemy import Boolean, Enum, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class UserRole(str, enum.Enum):
    owner = "owner"
    admin = "admin"
    employee = "employee"


class User(Base, TimestampMixin):
    __tablename__ = "users"
    __table_args__ = (UniqueConstraint("company_id", "login", name="uq_users_company_login"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)
    email: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True, index=True)
    login: Mapped[str | None] = mapped_column(String(64), nullable=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRole] = mapped_column(Enum(UserRole), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    company: Mapped["Company"] = relationship("Company", back_populates="users")
    extra_permissions: Mapped[list["UserPermission"]] = relationship(
        "UserPermission", back_populates="user", cascade="all, delete-orphan"
    )
    login_schedules: Mapped[list["LoginSchedule"]] = relationship(
        "LoginSchedule", back_populates="user", cascade="all, delete-orphan"
    )
    settings: Mapped[list["UserSetting"]] = relationship(
        "UserSetting", back_populates="user", cascade="all, delete-orphan"
    )
    featured_products: Mapped[list["UserFeaturedProduct"]] = relationship(
        "UserFeaturedProduct", back_populates="user", cascade="all, delete-orphan"
    )
