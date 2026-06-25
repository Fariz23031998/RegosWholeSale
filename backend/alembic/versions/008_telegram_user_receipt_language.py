"""telegram user receipt language

Revision ID: 008
Revises: 007
Create Date: 2026-06-25

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "008"
down_revision: Union[str, None] = "007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "telegram_users",
        sa.Column("receipt_language", sa.String(length=16), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("telegram_users", "receipt_language")
