"""partner telegram account is_active and multi-partner links

Revision ID: 032
Revises: 031
Create Date: 2026-11-11

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision: str = "032"
down_revision: Union[str, None] = "031"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_names(table: str) -> set[str]:
    bind = op.get_bind()
    return {column["name"] for column in inspect(bind).get_columns(table)}


def _has_table(table: str) -> bool:
    bind = op.get_bind()
    return inspect(bind).has_table(table)


def upgrade() -> None:
    if _has_table("partner_telegram_accounts"):
        columns = _column_names("partner_telegram_accounts")
        if "is_active" not in columns:
            op.add_column(
                "partner_telegram_accounts",
                sa.Column(
                    "is_active",
                    sa.Boolean(),
                    nullable=False,
                    server_default=sa.true(),
                ),
            )

    if not _has_table("partner_telegram_account_partners"):
        op.create_table(
            "partner_telegram_account_partners",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("account_id", sa.Integer(), nullable=False),
            sa.Column("regos_partner_id", sa.Integer(), nullable=False),
            sa.ForeignKeyConstraint(
                ["account_id"],
                ["partner_telegram_accounts.id"],
                ondelete="CASCADE",
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "account_id",
                "regos_partner_id",
                name="uq_partner_telegram_account_partners_account_partner",
            ),
        )
        op.create_index(
            op.f("ix_partner_telegram_account_partners_account_id"),
            "partner_telegram_account_partners",
            ["account_id"],
            unique=False,
        )
        op.create_index(
            op.f("ix_partner_telegram_account_partners_regos_partner_id"),
            "partner_telegram_account_partners",
            ["regos_partner_id"],
            unique=False,
        )

    if _has_table("partner_telegram_accounts") and _has_table("partner_telegram_account_partners"):
        op.execute(
            sa.text(
                """
                INSERT INTO partner_telegram_account_partners (account_id, regos_partner_id)
                SELECT id, regos_partner_id
                FROM partner_telegram_accounts
                WHERE regos_partner_id IS NOT NULL
                  AND NOT EXISTS (
                      SELECT 1
                      FROM partner_telegram_account_partners links
                      WHERE links.account_id = partner_telegram_accounts.id
                        AND links.regos_partner_id = partner_telegram_accounts.regos_partner_id
                  )
                """
            )
        )


def downgrade() -> None:
    if _has_table("partner_telegram_account_partners"):
        op.drop_index(
            op.f("ix_partner_telegram_account_partners_regos_partner_id"),
            table_name="partner_telegram_account_partners",
        )
        op.drop_index(
            op.f("ix_partner_telegram_account_partners_account_id"),
            table_name="partner_telegram_account_partners",
        )
        op.drop_table("partner_telegram_account_partners")

    if _has_table("partner_telegram_accounts"):
        columns = _column_names("partner_telegram_accounts")
        if "is_active" in columns:
            op.drop_column("partner_telegram_accounts", "is_active")
