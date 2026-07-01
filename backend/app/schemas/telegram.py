from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from app.services.telegram_notifications import (
    ALL_NOTIFICATION_TYPES,
    notification_categories_response,
    validate_notification_types,
)
from app.services.telegram_languages import SUPPORTED_RECEIPT_LANGUAGES, validate_receipt_language
from app.services.telegram_notification_scope import normalize_scope_ids


def _validate_scope_ids(value: list[int] | None) -> list[int] | None:
    if value is None:
        return None
    normalized = normalize_scope_ids(value)
    if len(normalized) != len(value):
        raise ValueError("Scope IDs must be unique positive integers")
    for item in value:
        if not isinstance(item, int) or item < 1:
            raise ValueError("Scope IDs must be unique positive integers")
    return normalized


class TelegramBotSaveRequest(BaseModel):
    bot_token: str = Field(min_length=1, max_length=255)


class TelegramBotResponse(BaseModel):
    configured: bool
    bot_username: str | None = None
    token_masked: str = ""
    webhook_url: str | None = None


class TelegramBotMessage(BaseModel):
    message: str
    bot: TelegramBotResponse | None = None


class TelegramNotificationCategory(BaseModel):
    id: str
    subcategories: list[str]


class TelegramNotificationTypesResponse(BaseModel):
    categories: list[TelegramNotificationCategory]
    types: list[str]


class TelegramReceiptLanguagesResponse(BaseModel):
    languages: list[str]


class TelegramUserResponse(BaseModel):
    id: int
    telegram_user_id: int
    chat_id: int
    chat_type: str
    title: str | None = None
    username: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    language_code: str | None = None
    is_active: bool
    notification_types: list[str]
    receipt_language: str
    stock_ids: list[int]
    cashier_ids: list[int]
    firm_ids: list[int]
    created_at: datetime


class TelegramUserUpdateRequest(BaseModel):
    notification_types: list[str] | None = None
    is_active: bool | None = None
    receipt_language: str | None = None
    stock_ids: list[int] | None = None
    cashier_ids: list[int] | None = None
    firm_ids: list[int] | None = None

    @field_validator("notification_types")
    @classmethod
    def validate_types(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        return validate_notification_types(value)

    @field_validator("receipt_language")
    @classmethod
    def validate_language(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return validate_receipt_language(value)

    @field_validator("stock_ids", "cashier_ids", "firm_ids")
    @classmethod
    def validate_scope_ids(cls, value: list[int] | None) -> list[int] | None:
        return _validate_scope_ids(value)


def all_notification_types_response() -> TelegramNotificationTypesResponse:
    return TelegramNotificationTypesResponse(
        categories=[
            TelegramNotificationCategory(id=item["id"], subcategories=item["subcategories"])
            for item in notification_categories_response()
        ],
        types=list(ALL_NOTIFICATION_TYPES),
    )


def all_receipt_languages_response() -> TelegramReceiptLanguagesResponse:
    return TelegramReceiptLanguagesResponse(languages=list(SUPPORTED_RECEIPT_LANGUAGES))
