from typing import Any

from sqlalchemy import JSON, BigInteger, Boolean, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class TelegramUser(Base, TimestampMixin):
    __tablename__ = "telegram_users"
    __table_args__ = (UniqueConstraint("company_id", "chat_id", name="uq_telegram_users_company_chat"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(
        ForeignKey("companies.id", ondelete="CASCADE"), nullable=False, index=True
    )
    telegram_user_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    chat_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    chat_type: Mapped[str] = mapped_column(String(16), default="private", nullable=False)
    title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    username: Mapped[str | None] = mapped_column(String(255), nullable=True)
    first_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    last_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    language_code: Mapped[str | None] = mapped_column(String(16), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    notification_types: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    receipt_language: Mapped[str | None] = mapped_column(String(16), nullable=True)

    company: Mapped["Company"] = relationship("Company", back_populates="telegram_users")
