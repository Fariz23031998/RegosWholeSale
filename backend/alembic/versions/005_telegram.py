"""telegram bots and users

Revision ID: 005
Revises: 004
Create Date: 2026-06-21

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "005"
down_revision: Union[str, None] = "004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "telegram_bots",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("company_id", sa.Integer(), nullable=False),
        sa.Column("bot_token", sa.String(length=255), nullable=False),
        sa.Column("bot_username", sa.String(length=255), nullable=True),
        sa.Column("webhook_secret", sa.String(length=64), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("company_id"),
        sa.UniqueConstraint("webhook_secret"),
    )
    op.create_index(op.f("ix_telegram_bots_company_id"), "telegram_bots", ["company_id"], unique=True)
    op.create_index(op.f("ix_telegram_bots_webhook_secret"), "telegram_bots", ["webhook_secret"], unique=True)

    op.create_table(
        "telegram_users",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("company_id", sa.Integer(), nullable=False),
        sa.Column("telegram_user_id", sa.BigInteger(), nullable=False),
        sa.Column("chat_id", sa.BigInteger(), nullable=False),
        sa.Column("username", sa.String(length=255), nullable=True),
        sa.Column("first_name", sa.String(length=255), nullable=True),
        sa.Column("last_name", sa.String(length=255), nullable=True),
        sa.Column("language_code", sa.String(length=16), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("company_id", "telegram_user_id", name="uq_telegram_users_company_user"),
    )
    op.create_index(op.f("ix_telegram_users_company_id"), "telegram_users", ["company_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_telegram_users_company_id"), table_name="telegram_users")
    op.drop_table("telegram_users")
    op.drop_index(op.f("ix_telegram_bots_webhook_secret"), table_name="telegram_bots")
    op.drop_index(op.f("ix_telegram_bots_company_id"), table_name="telegram_bots")
    op.drop_table("telegram_bots")
