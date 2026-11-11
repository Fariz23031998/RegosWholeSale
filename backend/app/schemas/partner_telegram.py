import re
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

_BALANCE_TIME = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
_BALANCE_TEMPLATE_LIMIT = 3500


class PartnerBalanceNotifyTemplates(BaseModel):
    uz: str = ""
    ru: str = ""
    en: str = ""

    @field_validator("uz", "ru", "en")
    @classmethod
    def template_is_limited(cls, value: str) -> str:
        cleaned = value.strip()
        if len(cleaned) > _BALANCE_TEMPLATE_LIMIT:
            raise ValueError("template must be at most 3500 characters")
        return cleaned


PORTAL_PAGE_KEYS = (
    "catalog",
    "create_orders",
    "dashboard",
    "orders",
    "purchases",
    "purchase_returns",
    "shipments",
    "shipment_returns",
    "payments",
    "reconciliation",
)

OrderDocumentType = Literal["doc_wholesale", "doc_order_from_partner"]


def default_enabled_pages() -> dict[str, bool]:
    return {key: True for key in PORTAL_PAGE_KEYS}


class PartnerTelegramBotResponse(BaseModel):
    configured: bool
    bot_username: str | None = None
    token_masked: str = ""
    webhook_url: str | None = None
    mini_app_url: str | None = None
    public_key: str | None = None
    default_warehouse_id: int | None = None
    default_price_type_id: int | None = None
    allow_catalog_warehouse_selection: bool = False
    allow_self_registration: bool = False
    show_product_quantities: bool = True
    auto_open_qty_keypad: bool = False
    default_partner_group_id: int | None = None
    catalog_product_group_ids: list[int] = Field(default_factory=list)
    enabled_pages: dict[str, bool] = Field(default_factory=default_enabled_pages)
    balance_notify_enabled: bool = False
    balance_notify_time: str = "09:00"
    balance_notify_option: str = "daily"
    balance_notify_days: list[int] = Field(default_factory=list)
    balance_notify_templates: PartnerBalanceNotifyTemplates = Field(
        default_factory=PartnerBalanceNotifyTemplates
    )
    order_document_type: OrderDocumentType = "doc_order_from_partner"
    order_booked: bool = True


class PartnerTelegramBotSaveRequest(BaseModel):
    bot_token: str = Field(min_length=1, max_length=255)


class PartnerTelegramBotSettingsRequest(BaseModel):
    default_warehouse_id: int | None = None
    default_price_type_id: int | None = None
    allow_catalog_warehouse_selection: bool = False
    allow_self_registration: bool = False
    show_product_quantities: bool = True
    auto_open_qty_keypad: bool = False
    default_partner_group_id: int | None = None
    catalog_product_group_ids: list[int] = Field(default_factory=list)
    enabled_pages: dict[str, bool] = Field(default_factory=default_enabled_pages)
    balance_notify_enabled: bool = False
    balance_notify_time: str = "09:00"
    balance_notify_option: Literal["daily", "weekdays", "monthly"] = "daily"
    balance_notify_days: list[int] = Field(default_factory=list)
    balance_notify_templates: PartnerBalanceNotifyTemplates = Field(
        default_factory=PartnerBalanceNotifyTemplates
    )
    order_document_type: OrderDocumentType = "doc_order_from_partner"
    order_booked: bool = True

    @field_validator("default_warehouse_id", "default_price_type_id", "default_partner_group_id")
    @classmethod
    def optional_id_must_be_positive(cls, value: int | None) -> int | None:
        if value is not None and value < 1:
            raise ValueError("id must be positive")
        return value

    @field_validator("enabled_pages")
    @classmethod
    def enabled_pages_must_use_known_keys(cls, value: dict[str, bool]) -> dict[str, bool]:
        pages = default_enabled_pages()
        if isinstance(value, dict):
            for key, enabled in value.items():
                if key in pages:
                    pages[key] = bool(enabled)
        return pages

    @field_validator("balance_notify_time")
    @classmethod
    def balance_time_must_be_hhmm(cls, value: str) -> str:
        cleaned = value.strip()
        if not _BALANCE_TIME.fullmatch(cleaned):
            raise ValueError("time must be HH:MM")
        return cleaned

    @field_validator("balance_notify_days")
    @classmethod
    def balance_days_are_unique(cls, value: list[int]) -> list[int]:
        return sorted(set(value))

    @model_validator(mode="after")
    def balance_days_match_option(self) -> "PartnerTelegramBotSettingsRequest":
        if self.balance_notify_option == "daily":
            self.balance_notify_days = []
            return self
        if self.balance_notify_option == "weekdays":
            if not self.balance_notify_days or any(day < 0 or day > 6 for day in self.balance_notify_days):
                raise ValueError("choose at least one weekday from 0 to 6")
        elif not self.balance_notify_days or any(day < 1 or day > 31 for day in self.balance_notify_days):
            raise ValueError("choose at least one day from 1 to 31")
        return self


class PartnerTelegramBotMessage(BaseModel):
    message: str
    bot: PartnerTelegramBotResponse | None = None


class PartnerTelegramAccountResponse(BaseModel):
    id: int
    telegram_user_id: int
    chat_id: int
    username: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    phone: str | None = None
    language_code: str | None = None
    regos_partner_id: int | None = None
    partner_name: str | None = None
    link_state: str
    warehouse_id: int | None = None
    price_type_id: int | None = None
    page_overrides: dict[str, bool] = Field(default_factory=dict)
    enabled_pages: dict[str, bool] = Field(default_factory=default_enabled_pages)
    has_password: bool = False
    created_at: datetime


class PartnerTelegramImportFieldOption(BaseModel):
    id: str
    label: str
    kind: Literal["standard", "custom"]


class PartnerTelegramImportFieldsResponse(BaseModel):
    fields: list[PartnerTelegramImportFieldOption] = Field(default_factory=list)


class PartnerTelegramImportFromFieldRequest(BaseModel):
    field_id: str = Field(min_length=1, max_length=128)

    @field_validator("field_id")
    @classmethod
    def field_id_must_be_nonempty(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("field_id is required")
        return cleaned


class PartnerTelegramImportFromFieldResponse(BaseModel):
    created: int = 0
    already_imported: int = 0
    skipped_empty: int = 0
    skipped_invalid: int = 0
    skipped_duplicate: int = 0
    skipped_partner_linked: int = 0
    total_partners: int = 0


class PartnerTelegramAccountUpdateRequest(BaseModel):
    regos_partner_id: int | None = None
    warehouse_id: int | None = None
    price_type_id: int | None = None
    page_overrides: dict[str, bool] | None = None

    @field_validator("regos_partner_id", "warehouse_id", "price_type_id")
    @classmethod
    def optional_id_must_be_positive(cls, value: int | None) -> int | None:
        if value is not None and value < 1:
            raise ValueError("id must be positive")
        return value

    @field_validator("page_overrides")
    @classmethod
    def page_overrides_must_use_known_keys(
        cls, value: dict[str, bool] | None
    ) -> dict[str, bool] | None:
        if value is None:
            return None
        known = set(PORTAL_PAGE_KEYS)
        return {key: bool(enabled) for key, enabled in value.items() if key in known}


class PartnerWebAppAuthRequest(BaseModel):
    public_key: str = Field(min_length=1, max_length=64)
    init_data: str = Field(min_length=1)


class PartnerWebAppAuthResponse(BaseModel):
    access_token: str
    account: PartnerTelegramAccountResponse


class PartnerOrderItemRequest(BaseModel):
    product_id: int = Field(ge=1)
    quantity: float = Field(gt=0)


class PartnerOrderCreateRequest(BaseModel):
    is_takeaway: bool
    address: str = ""
    phone: str | None = None
    warehouse_id: int | None = Field(default=None, ge=1)
    items: list[PartnerOrderItemRequest] = Field(min_length=1)


class PartnerPasswordLoginRequest(BaseModel):
    public_key: str = Field(min_length=1, max_length=64)
    phone: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=128)


class PartnerPasswordRequest(BaseModel):
    public_key: str = Field(min_length=1, max_length=64)
    phone: str = Field(min_length=1, max_length=64)


class PartnerPasswordConfirmRequest(BaseModel):
    public_key: str = Field(min_length=1, max_length=64)
    phone: str = Field(min_length=1, max_length=64)
    code: str = Field(min_length=4, max_length=8)
    password: str = Field(min_length=8, max_length=128)
