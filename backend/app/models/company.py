from datetime import UTC, datetime
from typing import Any

from sqlalchemy import JSON, DateTime, Enum, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin
from app.models.subscription import SubscriptionStatus


class Company(Base, TimestampMixin):
    __tablename__ = "companies"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    timezone: Mapped[str] = mapped_column(String(64), default="UTC", nullable=False)
    settings: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    subscription_status: Mapped[SubscriptionStatus] = mapped_column(
        Enum(SubscriptionStatus),
        default=SubscriptionStatus.trial,
        nullable=False,
    )
    subscription_expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )
    internal_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    users: Mapped[list["User"]] = relationship("User", back_populates="company")
    regos_token: Mapped["RegosToken | None"] = relationship(
        "RegosToken", back_populates="company", uselist=False
    )
    telegram_bot: Mapped["TelegramBot | None"] = relationship(
        "TelegramBot", back_populates="company", uselist=False
    )
    telegram_users: Mapped[list["TelegramUser"]] = relationship(
        "TelegramUser", back_populates="company"
    )
    subscription_payments: Mapped[list["SubscriptionPayment"]] = relationship(
        "SubscriptionPayment", back_populates="company", order_by="SubscriptionPayment.paid_at.desc()"
    )
