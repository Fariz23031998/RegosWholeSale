"""partner telegram notification templates per type

Revision ID: 033
Revises: 032
Create Date: 2026-11-13

"""

import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect, text

revision: str = "033"
down_revision: Union[str, None] = "032"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_EMPTY_LANG = {"uz": "", "ru": "", "en": ""}
_DEFAULT_NOTIFICATION_TEMPLATES = {
    "purchase": dict(_EMPTY_LANG),
    "return_purchase": dict(_EMPTY_LANG),
    "wholesale": dict(_EMPTY_LANG),
    "wholesale_return": dict(_EMPTY_LANG),
    "payment": dict(_EMPTY_LANG),
    "balance": dict(_EMPTY_LANG),
}


def _column_names(table: str) -> set[str]:
    bind = op.get_bind()
    return {column["name"] for column in inspect(bind).get_columns(table)}


def _default_json() -> str:
    return json.dumps(_DEFAULT_NOTIFICATION_TEMPLATES, separators=(",", ":"))


def _lang_templates(value: object) -> dict[str, str]:
    source = value if isinstance(value, dict) else {}
    return {
        lang: (source.get(lang) or "").strip() if isinstance(source.get(lang), str) else ""
        for lang in ("uz", "ru", "en")
    }


def upgrade() -> None:
    if "notification_templates" not in _column_names("partner_telegram_bots"):
        op.add_column(
            "partner_telegram_bots",
            sa.Column(
                "notification_templates",
                sa.JSON(),
                nullable=False,
                server_default=sa.text("'" + _default_json() + "'"),
            ),
        )

    if "balance_notify_templates" in _column_names("partner_telegram_bots"):
        bind = op.get_bind()
        rows = bind.execute(
            text(
                "SELECT id, balance_notify_templates, notification_templates "
                "FROM partner_telegram_bots"
            )
        ).mappings()
        for row in rows:
            templates = {
                key: dict(value) for key, value in _DEFAULT_NOTIFICATION_TEMPLATES.items()
            }
            existing = row["notification_templates"]
            if isinstance(existing, dict):
                for key, value in existing.items():
                    if key in templates:
                        templates[key] = _lang_templates(value)
            templates["balance"] = _lang_templates(row["balance_notify_templates"])
            bind.execute(
                text(
                    "UPDATE partner_telegram_bots "
                    "SET notification_templates = CAST(:payload AS json) "
                    "WHERE id = :id"
                ),
                {"id": row["id"], "payload": json.dumps(templates)},
            )
        op.drop_column("partner_telegram_bots", "balance_notify_templates")


def downgrade() -> None:
    if "balance_notify_templates" not in _column_names("partner_telegram_bots"):
        op.add_column(
            "partner_telegram_bots",
            sa.Column(
                "balance_notify_templates",
                sa.JSON(),
                nullable=False,
                server_default=sa.text("""'{"uz":"","ru":"","en":""}'"""),
            ),
        )

    if "notification_templates" in _column_names("partner_telegram_bots"):
        bind = op.get_bind()
        rows = bind.execute(
            text("SELECT id, notification_templates FROM partner_telegram_bots")
        ).mappings()
        for row in rows:
            balance = {"uz": "", "ru": "", "en": ""}
            templates = row["notification_templates"]
            if isinstance(templates, dict):
                balance = _lang_templates(templates.get("balance"))
            bind.execute(
                text(
                    "UPDATE partner_telegram_bots "
                    "SET balance_notify_templates = CAST(:payload AS json) "
                    "WHERE id = :id"
                ),
                {"id": row["id"], "payload": json.dumps(balance)},
            )
        op.drop_column("partner_telegram_bots", "notification_templates")
