"""partner telegram bots and accounts

Revision ID: 021
Revises: 020
Create Date: 2026-11-08

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "021"
down_revision: Union[str, None] = "020"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "partner_telegram_bots",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("company_id", sa.Integer(), nullable=False),
        sa.Column("bot_token", sa.String(length=255), nullable=False),
        sa.Column("bot_username", sa.String(length=255), nullable=True),
        sa.Column("webhook_secret", sa.String(length=64), nullable=False),
        sa.Column("public_key", sa.String(length=64), nullable=False),
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
        sa.UniqueConstraint("public_key"),
        sa.UniqueConstraint("webhook_secret"),
    )
    op.create_index(
        op.f("ix_partner_telegram_bots_company_id"),
        "partner_telegram_bots",
        ["company_id"],
        unique=True,
    )
    op.create_index(
        op.f("ix_partner_telegram_bots_public_key"),
        "partner_telegram_bots",
        ["public_key"],
        unique=True,
    )
    op.create_index(
        op.f("ix_partner_telegram_bots_webhook_secret"),
        "partner_telegram_bots",
        ["webhook_secret"],
        unique=True,
    )

    op.create_table(
        "partner_telegram_accounts",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("company_id", sa.Integer(), nullable=False),
        sa.Column("bot_id", sa.Integer(), nullable=False),
        sa.Column("telegram_user_id", sa.BigInteger(), nullable=False),
        sa.Column("chat_id", sa.BigInteger(), nullable=False),
        sa.Column("username", sa.String(length=255), nullable=True),
        sa.Column("first_name", sa.String(length=255), nullable=True),
        sa.Column("last_name", sa.String(length=255), nullable=True),
        sa.Column("phone", sa.String(length=64), nullable=True),
        sa.Column("language_code", sa.String(length=8), nullable=True),
        sa.Column("regos_partner_id", sa.Integer(), nullable=True),
        sa.Column("link_state", sa.String(length=32), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["bot_id"], ["partner_telegram_bots.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "company_id",
            "telegram_user_id",
            name="uq_partner_telegram_accounts_company_user",
        ),
    )
    op.create_index(
        op.f("ix_partner_telegram_accounts_bot_id"),
        "partner_telegram_accounts",
        ["bot_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_partner_telegram_accounts_company_id"),
        "partner_telegram_accounts",
        ["company_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_partner_telegram_accounts_regos_partner_id"),
        "partner_telegram_accounts",
        ["regos_partner_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_partner_telegram_accounts_regos_partner_id"),
        table_name="partner_telegram_accounts",
    )
    op.drop_index(
        op.f("ix_partner_telegram_accounts_company_id"),
        table_name="partner_telegram_accounts",
    )
    op.drop_index(
        op.f("ix_partner_telegram_accounts_bot_id"),
        table_name="partner_telegram_accounts",
    )
    op.drop_table("partner_telegram_accounts")
    op.drop_index(
        op.f("ix_partner_telegram_bots_webhook_secret"),
        table_name="partner_telegram_bots",
    )
    op.drop_index(
        op.f("ix_partner_telegram_bots_public_key"),
        table_name="partner_telegram_bots",
    )
    op.drop_index(
        op.f("ix_partner_telegram_bots_company_id"),
        table_name="partner_telegram_bots",
    )
    op.drop_table("partner_telegram_bots")
