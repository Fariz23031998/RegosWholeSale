"""telegram group subscribers

Revision ID: 014
Revises: 013
Create Date: 2026-06-28

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "014"
down_revision: Union[str, None] = "013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("telegram_users", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("chat_type", sa.String(length=16), nullable=False, server_default="private")
        )
        batch_op.add_column(sa.Column("title", sa.String(length=255), nullable=True))
        batch_op.drop_constraint("uq_telegram_users_company_user", type_="unique")
        batch_op.create_unique_constraint(
            "uq_telegram_users_company_chat",
            ["company_id", "chat_id"],
        )


def downgrade() -> None:
    with op.batch_alter_table("telegram_users", schema=None) as batch_op:
        batch_op.drop_constraint("uq_telegram_users_company_chat", type_="unique")
        batch_op.create_unique_constraint(
            "uq_telegram_users_company_user",
            ["company_id", "telegram_user_id"],
        )
        batch_op.drop_column("title")
        batch_op.drop_column("chat_type")
