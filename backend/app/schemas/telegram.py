from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from app.services.telegram_notifications import ALL_NOTIFICATION_TYPES, validate_notification_types
from app.services.telegram_languages import SUPPORTED_RECEIPT_LANGUAGES, validate_receipt_language


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


class TelegramNotificationTypesResponse(BaseModel):
    types: list[str]


class TelegramReceiptLanguagesResponse(BaseModel):
    languages: list[str]


class TelegramUserResponse(BaseModel):
    id: int
    telegram_user_id: int
    chat_id: int
    username: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    language_code: str | None = None
    is_active: bool
    notification_types: list[str]
    receipt_language: str
    created_at: datetime


class TelegramUserUpdateRequest(BaseModel):
    notification_types: list[str] | None = None
    is_active: bool | None = None
    receipt_language: str | None = None

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


def all_notification_types_response() -> TelegramNotificationTypesResponse:
    return TelegramNotificationTypesResponse(types=list(ALL_NOTIFICATION_TYPES))


def all_receipt_languages_response() -> TelegramReceiptLanguagesResponse:
    return TelegramReceiptLanguagesResponse(languages=list(SUPPORTED_RECEIPT_LANGUAGES))
