"""telegram_users.pos_cheque_storno_filters for closed/return modes

Revision ID: 039
Revises: 038
Create Date: 2026-11-16

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision: str = "039"
down_revision: Union[str, None] = "038"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_names(table: str) -> set[str]:
    bind = op.get_bind()
    return {column["name"] for column in inspect(bind).get_columns(table)}


def upgrade() -> None:
    columns = _column_names("telegram_users")
    if "pos_cheque_storno_filters" not in columns:
        op.add_column(
            "telegram_users",
            sa.Column("pos_cheque_storno_filters", sa.JSON(), nullable=True),
        )


def downgrade() -> None:
    columns = _column_names("telegram_users")
    if "pos_cheque_storno_filters" in columns:
        op.drop_column("telegram_users", "pos_cheque_storno_filters")
