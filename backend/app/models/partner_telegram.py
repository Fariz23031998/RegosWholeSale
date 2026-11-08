import enum
from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, String, UniqueConstraint, false, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class PartnerTelegramLinkState(str, enum.Enum):
    awaiting_language = "awaiting_language"
    unlinked = "unlinked"
    linked = "linked"


class PartnerTelegramBot(Base, TimestampMixin):
    __tablename__ = "partner_telegram_bots"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(
        ForeignKey("companies.id", ondelete="CASCADE"), unique=True, nullable=False, index=True
    )
    bot_token: Mapped[str] = mapped_column(String(255), nullable=False)
    bot_username: Mapped[str | None] = mapped_column(String(255), nullable=True)
    webhook_secret: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    public_key: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    default_warehouse_id: Mapped[int | None] = mapped_column(nullable=True)
    default_price_type_id: Mapped[int | None] = mapped_column(nullable=True)
    allow_catalog_warehouse_selection: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
    allow_self_registration: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
    default_partner_group_id: Mapped[int | None] = mapped_column(nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    company: Mapped["Company"] = relationship("Company", back_populates="partner_telegram_bot")
    accounts: Mapped[list["PartnerTelegramAccount"]] = relationship(
        "PartnerTelegramAccount", back_populates="bot", cascade="all, delete-orphan"
    )


class PartnerTelegramAccount(Base, TimestampMixin):
    __tablename__ = "partner_telegram_accounts"
    __table_args__ = (
        UniqueConstraint(
            "company_id",
            "telegram_user_id",
            name="uq_partner_telegram_accounts_company_user",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(
        ForeignKey("companies.id", ondelete="CASCADE"), nullable=False, index=True
    )
    bot_id: Mapped[int] = mapped_column(
        ForeignKey("partner_telegram_bots.id", ondelete="CASCADE"), nullable=False, index=True
    )
    telegram_user_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    chat_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    username: Mapped[str | None] = mapped_column(String(255), nullable=True)
    first_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    last_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(64), nullable=True)
    language_code: Mapped[str | None] = mapped_column(String(8), nullable=True)
    regos_partner_id: Mapped[int | None] = mapped_column(nullable=True, index=True)
    link_state: Mapped[str] = mapped_column(
        String(32),
        default=PartnerTelegramLinkState.awaiting_language.value,
        nullable=False,
    )
    warehouse_id: Mapped[int | None] = mapped_column(nullable=True)
    price_type_id: Mapped[int | None] = mapped_column(nullable=True)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)

    company: Mapped["Company"] = relationship("Company", back_populates="partner_telegram_accounts")
    bot: Mapped["PartnerTelegramBot"] = relationship("PartnerTelegramBot", back_populates="accounts")


class PartnerTelegramPasswordCode(Base):
    __tablename__ = "partner_telegram_password_codes"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    account_id: Mapped[int] = mapped_column(
        ForeignKey("partner_telegram_accounts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    code: Mapped[str] = mapped_column(String(6), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
