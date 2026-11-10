"""partner telegram portal order document settings

Revision ID: 028
Revises: 027
Create Date: 2026-11-10

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision: str = "028"
down_revision: Union[str, None] = "027"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_names(table: str) -> set[str]:
    bind = op.get_bind()
    return {column["name"] for column in inspect(bind).get_columns(table)}


def upgrade() -> None:
    columns = _column_names("partner_telegram_bots")
    if "order_document_type" not in columns:
        op.add_column(
            "partner_telegram_bots",
            sa.Column(
                "order_document_type",
                sa.String(length=32),
                nullable=False,
                server_default="doc_order_from_partner",
            ),
        )
    if "order_booked" not in columns:
        op.add_column(
            "partner_telegram_bots",
            sa.Column(
                "order_booked",
                sa.Boolean(),
                nullable=False,
                server_default=sa.true(),
            ),
        )


def downgrade() -> None:
    columns = _column_names("partner_telegram_bots")
    if "order_booked" in columns:
        op.drop_column("partner_telegram_bots", "order_booked")
    if "order_document_type" in columns:
        op.drop_column("partner_telegram_bots", "order_document_type")
