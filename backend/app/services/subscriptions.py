from datetime import UTC, datetime, timedelta

from app.config import get_settings
from app.models.company import Company
from app.models.subscription import SubscriptionStatus

settings = get_settings()


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value


def is_subscription_active(company: Company) -> bool:
    mark_expired_if_needed(company)
    if company.subscription_status not in (
        SubscriptionStatus.trial,
        SubscriptionStatus.active,
    ):
        return False
    return datetime.now(UTC) < _as_utc(company.subscription_expires_at)


def mark_expired_if_needed(company: Company) -> None:
    if company.subscription_status not in (
        SubscriptionStatus.trial,
        SubscriptionStatus.active,
    ):
        return
    if datetime.now(UTC) >= _as_utc(company.subscription_expires_at):
        company.subscription_status = SubscriptionStatus.expired


def start_trial(company: Company) -> None:
    now = datetime.now(UTC)
    company.subscription_status = SubscriptionStatus.trial
    company.subscription_expires_at = now + timedelta(days=settings.registration_trial_days)


def extend_subscription(
    company: Company,
    *,
    days: int,
    status: SubscriptionStatus = SubscriptionStatus.active,
) -> None:
    now = datetime.now(UTC)
    base = company.subscription_expires_at
    if base is None:
        base = now
    else:
        base = _as_utc(base)
        if base < now:
            base = now
    company.subscription_expires_at = base + timedelta(days=days)
    company.subscription_status = status


def set_subscription(
    company: Company,
    *,
    status: SubscriptionStatus,
    expires_at: datetime | None = None,
) -> None:
    company.subscription_status = status
    if expires_at is not None:
        company.subscription_expires_at = expires_at
