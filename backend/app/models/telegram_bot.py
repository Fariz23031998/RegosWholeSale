from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class TelegramBot(Base, TimestampMixin):
    __tablename__ = "telegram_bots"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(
        ForeignKey("companies.id", ondelete="CASCADE"), unique=True, nullable=False, index=True
    )
    bot_token: Mapped[str] = mapped_column(String(255), nullable=False)
    bot_username: Mapped[str | None] = mapped_column(String(255), nullable=True)
    webhook_secret: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    company: Mapped["Company"] = relationship("Company", back_populates="telegram_bot")
