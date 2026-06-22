from datetime import datetime

from pydantic import BaseModel, Field


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


class TelegramUserResponse(BaseModel):
    id: int
    telegram_user_id: int
    chat_id: int
    username: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    language_code: str | None = None
    is_active: bool
    created_at: datetime
