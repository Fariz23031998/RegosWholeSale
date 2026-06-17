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

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
