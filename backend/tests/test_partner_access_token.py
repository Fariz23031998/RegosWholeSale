from datetime import UTC, datetime, timedelta

import pytest
from jose import jwt

from app.config import get_settings
from app.core.security import create_partner_telegram_token, decode_access_token


def test_partner_access_token_uses_configured_expire_hours(monkeypatch):
    monkeypatch.setenv("PARTNER_ACCESS_TOKEN_EXPIRE_HOURS", "24")
    get_settings.cache_clear()
    try:
        settings = get_settings()
        assert settings.partner_access_token_expire_hours == 24

        before = datetime.now(UTC)
        token = create_partner_telegram_token(account_id=11, company_id=22)
        after = datetime.now(UTC)
        payload = decode_access_token(token)

        assert payload["typ"] == "partner_telegram"
        assert payload["sub"] == "11"
        assert payload["company_id"] == 22
        exp = datetime.fromtimestamp(payload["exp"], UTC)
        assert before + timedelta(hours=24) - timedelta(seconds=5) <= exp <= after + timedelta(hours=24)
    finally:
        get_settings.cache_clear()


def test_expired_partner_access_token_is_rejected(monkeypatch):
    monkeypatch.setenv("PARTNER_ACCESS_TOKEN_EXPIRE_HOURS", "24")
    get_settings.cache_clear()
    try:
        settings = get_settings()
        token = jwt.encode(
            {
                "sub": "11",
                "typ": "partner_telegram",
                "company_id": 22,
                "exp": datetime.now(UTC) - timedelta(seconds=1),
            },
            settings.secret_key,
            algorithm=settings.algorithm,
        )
        with pytest.raises(ValueError, match="Invalid token"):
            decode_access_token(token)
    finally:
        get_settings.cache_clear()
