"""partner portal page enable defaults and overrides

Revision ID: 027
Revises: 026
Create Date: 2026-11-10

"""

import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision: str = "027"
down_revision: Union[str, None] = "026"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# json.dumps adds a space after ":", so SQLAlchemy text() does not treat
# ":true" as a bind parameter name.
_DEFAULT_ENABLED_PAGES = "'" + json.dumps(
    {
        "catalog": True,
        "dashboard": True,
        "orders": True,
        "purchases": True,
        "purchase_returns": True,
        "shipments": True,
        "shipment_returns": True,
        "payments": True,
        "reconciliation": True,
    }
) + "'"


def _column_names(table: str) -> set[str]:
    bind = op.get_bind()
    return {column["name"] for column in inspect(bind).get_columns(table)}


def upgrade() -> None:
    if "enabled_pages" not in _column_names("partner_telegram_bots"):
        op.add_column(
            "partner_telegram_bots",
            sa.Column(
                "enabled_pages",
                sa.JSON(),
                nullable=False,
                server_default=sa.text(_DEFAULT_ENABLED_PAGES),
            ),
        )
    if "page_overrides" not in _column_names("partner_telegram_accounts"):
        op.add_column(
            "partner_telegram_accounts",
            sa.Column(
                "page_overrides",
                sa.JSON(),
                nullable=False,
                server_default=sa.text("'{}'"),
            ),
        )


def downgrade() -> None:
    if "page_overrides" in _column_names("partner_telegram_accounts"):
        op.drop_column("partner_telegram_accounts", "page_overrides")
    if "enabled_pages" in _column_names("partner_telegram_bots"):
        op.drop_column("partner_telegram_bots", "enabled_pages")
