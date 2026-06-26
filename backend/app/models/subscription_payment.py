from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class SubscriptionPayment(Base, TimestampMixin):
    __tablename__ = "subscription_payments"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(
        ForeignKey("companies.id", ondelete="CASCADE"), nullable=False, index=True
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(8), default="UZS", nullable=False)
    period_months: Mapped[int] = mapped_column(Integer, nullable=False)
    period_days: Mapped[int] = mapped_column(Integer, nullable=False)
    paid_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    recorded_by_admin_id: Mapped[int | None] = mapped_column(
        ForeignKey("platform_admins.id", ondelete="SET NULL"), nullable=True
    )

    company: Mapped["Company"] = relationship("Company", back_populates="subscription_payments")
    recorded_by: Mapped["PlatformAdmin | None"] = relationship("PlatformAdmin")
