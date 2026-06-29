"""telegram user stock and cashier scope

Revision ID: 016
Revises: 015
Create Date: 2026-06-29

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "016"
down_revision: Union[str, None] = "015"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("telegram_users", sa.Column("stock_ids", sa.JSON(), nullable=True))
    op.add_column("telegram_users", sa.Column("cashier_ids", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("telegram_users", "cashier_ids")
    op.drop_column("telegram_users", "stock_ids")
