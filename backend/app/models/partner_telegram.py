import enum
import json
from datetime import datetime

from sqlalchemy import JSON, BigInteger, Boolean, DateTime, ForeignKey, String, UniqueConstraint, false, func, text, true
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

_DEFAULT_ENABLED_PAGES = {
    "catalog": True,
    "create_orders": True,
    "dashboard": True,
    "orders": True,
    "purchases": True,
    "purchase_returns": True,
    "shipments": True,
    "shipment_returns": True,
    "payments": True,
    "reconciliation": True,
}
# Space after ":" avoids SQLAlchemy text() bind-param parsing of ":true".
_DEFAULT_ENABLED_PAGES_SQL = "'" + json.dumps(_DEFAULT_ENABLED_PAGES) + "'"


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
    show_product_quantities: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=true()
    )
    show_zero_quantity: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
    show_zero_price: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
    auto_open_qty_keypad: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
    default_partner_group_id: Mapped[int | None] = mapped_column(nullable=True)
    catalog_product_group_ids: Mapped[list[int]] = mapped_column(
        JSON, nullable=False, default=list, server_default=text("'[]'")
    )
    enabled_pages: Mapped[dict] = mapped_column(
        JSON,
        nullable=False,
        default=lambda: dict(_DEFAULT_ENABLED_PAGES),
        server_default=text(_DEFAULT_ENABLED_PAGES_SQL),
    )
    balance_notify_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
    balance_notify_schedules: Mapped[list] = mapped_column(
        JSON, nullable=False, default=list, server_default=text("'[]'")
    )
    balance_notify_templates: Mapped[dict] = mapped_column(
        JSON,
        nullable=False,
        default=lambda: {"uz": "", "ru": "", "en": ""},
        server_default=text("""'{"uz":"","ru":"","en":""}'"""),
    )
    order_document_type: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        default="doc_order_from_partner",
        server_default="doc_order_from_partner",
    )
    order_booked: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=true()
    )
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
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=true()
    )
    warehouse_id: Mapped[int | None] = mapped_column(nullable=True)
    price_type_id: Mapped[int | None] = mapped_column(nullable=True)
    page_overrides: Mapped[dict] = mapped_column(
        JSON, nullable=False, default=dict, server_default=text("'{}'")
    )
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)

    company: Mapped["Company"] = relationship("Company", back_populates="partner_telegram_accounts")
    bot: Mapped["PartnerTelegramBot"] = relationship("PartnerTelegramBot", back_populates="accounts")
    partner_links: Mapped[list["PartnerTelegramAccountPartner"]] = relationship(
        "PartnerTelegramAccountPartner",
        back_populates="account",
        cascade="all, delete-orphan",
    )


class PartnerTelegramAccountPartner(Base):
    __tablename__ = "partner_telegram_account_partners"
    __table_args__ = (
        UniqueConstraint(
            "account_id",
            "regos_partner_id",
            name="uq_partner_telegram_account_partners_account_partner",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    account_id: Mapped[int] = mapped_column(
        ForeignKey("partner_telegram_accounts.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    regos_partner_id: Mapped[int] = mapped_column(nullable=False, index=True)

    account: Mapped["PartnerTelegramAccount"] = relationship(
        "PartnerTelegramAccount", back_populates="partner_links"
    )


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
