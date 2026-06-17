import asyncio
import logging
from datetime import UTC, datetime, timedelta
from random import randint

import resend
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.exceptions import AppError, unauthorized
from app.models.verification_code import VerificationCode
from app.utils.email_template import format_verification_email, load_verification_template

logger = logging.getLogger("regos.backend")
settings = get_settings()

HTML_TEMPLATE = load_verification_template()
CODE_EXPIRE_MINUTES = 10
RATE_LIMIT_MINUTES = 3


def generate_verification_code() -> str:
    return str(randint(100000, 999999))


async def email_exists(session: AsyncSession, email: str) -> bool:
    from app.models import User

    result = await session.execute(select(User.id).where(User.email == email))
    return result.scalar_one_or_none() is not None


async def add_verification_code(session: AsyncSession, recipient: str) -> str:
    rate_limit_since = datetime.now(UTC) - timedelta(minutes=RATE_LIMIT_MINUTES)
    result = await session.execute(
        select(VerificationCode.created_at).where(
            VerificationCode.recipient == recipient,
            VerificationCode.created_at > rate_limit_since,
        )
    )
    if result.first():
        raise AppError(
            429,
            f"Please wait {RATE_LIMIT_MINUTES} minutes before requesting another code.",
            "RATE_LIMITED",
        )

    code = generate_verification_code()
    session.add(VerificationCode(recipient=recipient.lower(), code=code))
    await session.flush()
    return code


async def send_verification_email(recipient_email: str, code: str) -> dict:
    if not settings.resend_api_key:
        logger.warning("RESEND_API_KEY not set; skipping email send for %s", recipient_email)
        return {"ok": True, "result": "Email skipped (no API key)", "email_id": None}

    resend.api_key = settings.resend_api_key
    from_address = f"no-reply@{settings.resend_email_from}"
    html_body = format_verification_email(
        HTML_TEMPLATE,
        verification_code=code,
        app_name=settings.app_name,
    )
    params: resend.Emails.SendParams = {
        "from": from_address,
        "to": [recipient_email],
        "subject": f"{settings.app_name} - Verification Code",
        "html": html_body,
    }

    for attempt in range(5):
        try:
            email = await asyncio.to_thread(resend.Emails.send, params)
            logger.info("Verification email sent to %s, ID: %s", recipient_email, email.get("id"))
            return {"ok": True, "result": "Email sent", "email_id": email.get("id")}
        except Exception as exc:
            logger.error("Email send attempt %s failed: %s", attempt + 1, exc)
            await asyncio.sleep(1)

    return {"ok": False, "error": "Failed to send after 5 attempts."}


async def check_verification_code(session: AsyncSession, recipient_email: str, code: str) -> None:
    expire_since = datetime.now(UTC) - timedelta(minutes=CODE_EXPIRE_MINUTES)
    recipient = recipient_email.lower()
    result = await session.execute(
        select(VerificationCode.id)
        .where(
            VerificationCode.created_at > expire_since,
            VerificationCode.recipient == recipient,
            VerificationCode.code == code,
        )
        .limit(1)
    )
    if not result.scalar_one_or_none():
        raise unauthorized("Verification code not found.", "INVALID_VERIFICATION_CODE")

    await session.execute(
        delete(VerificationCode).where(
            VerificationCode.recipient == recipient,
            VerificationCode.code == code,
        )
    )
    await session.flush()


async def clean_verification_data(session: AsyncSession) -> int:
    expire_before = datetime.now(UTC) - timedelta(minutes=CODE_EXPIRE_MINUTES)
    result = await session.execute(
        delete(VerificationCode).where(VerificationCode.created_at < expire_before)
    )
    deleted = result.rowcount or 0
    logger.info("Deleted %s expired verification records", deleted)
    return deleted
