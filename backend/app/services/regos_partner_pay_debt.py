"""Create standalone Regos DocPayment documents to settle partner debt."""

from __future__ import annotations

import time
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import bad_request
from app.services import pos_settings as pos_settings_service
from app.services import regos_defaults as regos_defaults_service
from app.services import regos_payment_types as regos_payment_types_service
from app.services.regos_sales import (
    _add_account_movement,
    _add_payment_document,
    _regos_call,
    _resolve_payment_category_id,
    _resolve_payment_posting,
)
from app.utils.currency_conversion import parse_exchange_rate


async def pay_partner_debt(
    session: AsyncSession,
    company_id: int,
    user_id: int,
    *,
    partner_id: int,
    firm_id: int,
    payments: list[dict[str, Any]],
) -> dict[str, Any]:
    if not payments:
        raise bad_request("At least one payment is required.", "PARTNER_PAY_DEBT_EMPTY")

    defaults = await regos_defaults_service.apply_regos_session_overrides(
        session,
        company_id,
        user_id,
        partner_id=partner_id,
    )
    defaults = await regos_defaults_service.enrich_checkout_defaults(
        session, company_id, defaults, refresh=False
    )

    partner = defaults.get("partner")
    if not isinstance(partner, dict) or int(partner.get("id") or 0) != partner_id:
        defaults = dict(defaults)
        defaults["partner"] = {"id": partner_id, "name": str(partner_id)}

    firm = defaults.get("firm")
    if not isinstance(firm, dict) or int(firm.get("id") or 0) != firm_id:
        defaults = dict(defaults)
        defaults["firm"] = {"id": firm_id, "name": str(firm_id)}

    if not defaults.get("firm") or not defaults["firm"].get("id"):
        raise bad_request("Firm is required to pay partner debt.", "PARTNER_PAY_DEBT_FIRM_REQUIRED")
    if not defaults.get("partner") or not defaults["partner"].get("id"):
        raise bad_request(
            "Partner is required to pay partner debt.",
            "PARTNER_PAY_DEBT_PARTNER_REQUIRED",
        )

    category_id = _resolve_payment_category_id(defaults, is_return=False)
    pos_settings = await pos_settings_service.get_pos_settings(session, company_id)
    cross_currency_payment_mode = pos_settings.get(
        "cross_currency_payment_mode", "payment_currency"
    )

    partner_name = str(defaults["partner"].get("name") or partner_id)
    description = f"Partner debt · {partner_name}"

    payment_results: list[dict[str, Any]] = []
    payment_doc_ids: list[int] = []

    for index, payment in enumerate(payments):
        amount = round(float(payment["amount"]), 2)
        if amount <= 0:
            raise bad_request(
                "Payment amount must be greater than zero.",
                "PARTNER_PAY_DEBT_INVALID_AMOUNT",
            )

        payment_type_id = int(payment["payment_type_id"])
        currency_id = int(payment["currency_id"])
        debt_rate = parse_exchange_rate(payment.get("exchange_rate"))

        payment_type = await regos_payment_types_service.get_payment_type_by_id(
            session, company_id, payment_type_id
        )
        payment_currency = payment_type.get("currency")
        payment_rate = parse_exchange_rate(
            payment_currency.get("exchange_rate") if payment_currency else None
        )

        debt_currency: dict[str, Any] = {
            "id": currency_id,
            "name": str(payment.get("currency_name") or currency_id),
            "exchange_rate": debt_rate,
        }
        if payment.get("currency_code"):
            debt_currency["code_chr"] = payment["currency_code"]

        document_date = int(time.time()) + 1 + index

        posting = await _resolve_payment_posting(
            session,
            company_id,
            selected_payment_type=payment_type,
            sale_currency=debt_currency,
            line_amount_paid=amount,
            sale_rate=debt_rate,
            payment_rate=payment_rate,
            cross_currency_payment_mode=cross_currency_payment_mode,
            tendered=None,
            change=None,
            is_return=False,
            source_document_id=0,
            document_date=document_date,
            transfer_description=description,
        )

        payment_doc = await _add_payment_document(
            session,
            company_id,
            defaults,
            source_document_id=None,
            document_type_id=None,
            payment_type_id=posting["payment_type_id"],
            amount=posting["payment_doc_amount"],
            exchange_rate=posting["payment_exchange_rate"],
            category_id=category_id,
            document_date=document_date,
            description=description,
        )
        payment_doc_id = int(payment_doc["id"])
        await _regos_call(session, company_id, "docpayment/perform", {"id": payment_doc_id})

        if posting.get("account_transfer"):
            await _add_account_movement(
                session,
                company_id,
                defaults,
                **posting["account_transfer"],
            )

        payment_doc_ids.append(payment_doc_id)
        payment_results.append(
            {
                "payment_type_id": payment_type_id,
                "payment_doc_id": payment_doc_id,
                "currency_id": currency_id,
                "amount": amount,
                "payment_amount": posting["payment_amount"],
                "payment_currency": payment_currency,
            }
        )

    return {
        "payment_doc_ids": payment_doc_ids,
        "payments": payment_results,
    }
