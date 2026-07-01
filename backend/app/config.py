from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

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
    # Public base URL for Telegram bot webhooks and REGOS integration HandleWebhook
    telegram_webhook_base_url: str = ""
    public_app_base_url: str = ""
    receipt_share_ttl_hours: int = 24
    receipt_share_max_bytes: int = 2_097_152
    receipt_share_storage_dir: str = "./data/receipt-shares"
    receipt_share_hourly_upload_limit: int = 50
    registration_trial_days: int = 7
    subscription_days_per_month: int = 30
    platform_admin_email: str = ""
    platform_admin_password: str = ""

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def public_base_url(self) -> str:
        base = self.public_app_base_url.strip().rstrip("/")
        if base:
            return base
        return self.telegram_webhook_base_url.strip().rstrip("/")

    @property
    def regos_webhook_url(self) -> str | None:
        base = self.telegram_webhook_base_url.strip().rstrip("/")
        if not base:
            return None
        return f"{base}/api/v1/regos/webhook"


@lru_cache
def get_settings() -> Settings:
    return Settings()
