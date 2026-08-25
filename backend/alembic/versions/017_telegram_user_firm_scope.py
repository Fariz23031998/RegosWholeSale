"""telegram user firm scope

Revision ID: 017
Revises: 016
Create Date: 2026-07-01

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "017"
down_revision: Union[str, None] = "016"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("telegram_users", sa.Column("firm_ids", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("telegram_users", "firm_ids")
