"""partner telegram auto-open qty keypad setting

Revision ID: 029
Revises: 028
Create Date: 2026-11-10

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision: str = "029"
down_revision: Union[str, None] = "028"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_names(table: str) -> set[str]:
    bind = op.get_bind()
    return {column["name"] for column in inspect(bind).get_columns(table)}


def upgrade() -> None:
    columns = _column_names("partner_telegram_bots")
    if "auto_open_qty_keypad" not in columns:
        op.add_column(
            "partner_telegram_bots",
            sa.Column(
                "auto_open_qty_keypad",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            ),
        )


def downgrade() -> None:
    columns = _column_names("partner_telegram_bots")
    if "auto_open_qty_keypad" in columns:
        op.drop_column("partner_telegram_bots", "auto_open_qty_keypad")
