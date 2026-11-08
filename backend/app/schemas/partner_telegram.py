from datetime import datetime

from pydantic import BaseModel, Field, field_validator


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
    default_partner_group_id: int | None = None


class PartnerTelegramBotSaveRequest(BaseModel):
    bot_token: str = Field(min_length=1, max_length=255)


class PartnerTelegramBotSettingsRequest(BaseModel):
    default_warehouse_id: int | None = None
    default_price_type_id: int | None = None
    allow_catalog_warehouse_selection: bool = False
    allow_self_registration: bool = False
    default_partner_group_id: int | None = None

    @field_validator("default_warehouse_id", "default_price_type_id", "default_partner_group_id")
    @classmethod
    def optional_id_must_be_positive(cls, value: int | None) -> int | None:
        if value is not None and value < 1:
            raise ValueError("id must be positive")
        return value


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
    has_password: bool = False
    created_at: datetime


class PartnerTelegramAccountUpdateRequest(BaseModel):
    regos_partner_id: int | None = None
    warehouse_id: int | None = None
    price_type_id: int | None = None

    @field_validator("regos_partner_id", "warehouse_id", "price_type_id")
    @classmethod
    def optional_id_must_be_positive(cls, value: int | None) -> int | None:
        if value is not None and value < 1:
            raise ValueError("id must be positive")
        return value


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
