"""telegram user notification types

Revision ID: 007
Revises: 006
Create Date: 2026-06-25

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "007"
down_revision: Union[str, None] = "006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "telegram_users",
        sa.Column("notification_types", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("telegram_users", "notification_types")
