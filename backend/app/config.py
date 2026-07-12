from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def parse_hh_mm(value: str, *, default: tuple[int, int] = (10, 0)) -> tuple[int, int]:
    normalized = value.strip()
    if not normalized:
        return default
    parts = normalized.split(":")
    if len(parts) != 2:
        raise ValueError("Time must use HH:MM format.")
    try:
        hours = int(parts[0])
        minutes = int(parts[1])
    except ValueError as exc:
        raise ValueError("Time must use HH:MM format.") from exc
    if hours < 0 or hours > 23 or minutes < 0 or minutes > 59:
        raise ValueError("Time must use HH:MM format.")
    return hours, minutes


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Local/dev default. Production: postgresql+asyncpg://user:pass@127.0.0.1:5432/regos
    database_url: str = "sqlite+aiosqlite:///./data/regos.db"
    secret_key: str = "change-me-in-production"
    access_token_expire_minutes: int = 480
    cors_origins: str = "http://localhost:5173,http://localhost:3000"
    algorithm: str = "HS256"
    app_name: str = "Regos Wholesale"
    resend_api_key: str = ""
    resend_email_from: str = "resend.dev"
    regos_oauth_token_url: str = "https://auth.regos.uz/oauth/token"
    regos_client_id: str = ""
    regos_client_secret: str = ""
    # Public base URL for Telegram bot webhooks
    telegram_webhook_base_url: str = ""
    # Full REGOS HandleWebhook URL (e.g. https://example.com/api/v1/regos/webhook)
    regos_webhook_url: str = ""
    public_app_base_url: str = ""
    receipt_share_ttl_hours: int = 24
    receipt_share_max_bytes: int = 2_097_152
    receipt_share_storage_dir: str = "./data/receipt-shares"
    receipt_share_hourly_upload_limit: int = 50
    registration_trial_days: int = 7
    subscription_days_per_month: int = 30
    platform_admin_email: str = ""
    platform_admin_password: str = ""
    # Daily CBU exchange-rate fetch time in Asia/Tashkent (HH:MM, 24-hour)
    cbu_exchange_rate_fetch_time: str = "10:00"

    @field_validator("cbu_exchange_rate_fetch_time")
    @classmethod
    def validate_cbu_exchange_rate_fetch_time(cls, value: str) -> str:
        hours, minutes = parse_hh_mm(value)
        return f"{hours:02d}:{minutes:02d}"

    @property
    def cbu_exchange_rate_fetch_hour_minute(self) -> tuple[int, int]:
        return parse_hh_mm(self.cbu_exchange_rate_fetch_time)

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def public_base_url(self) -> str:
        base = self.public_app_base_url.strip().rstrip("/")
        if base:
            return base
        return self.telegram_webhook_base_url.strip().rstrip("/")


@lru_cache
def get_settings() -> Settings:
    return Settings()
