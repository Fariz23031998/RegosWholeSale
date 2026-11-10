"""partner portal defaults, passwords, and password codes

Revision ID: 022
Revises: 021
Create Date: 2026-11-08

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision: str = "022"
down_revision: Union[str, None] = "021"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_names(table: str) -> set[str]:
    bind = op.get_bind()
    return {column["name"] for column in inspect(bind).get_columns(table)}


def _add_column_if_missing(table: str, column: sa.Column) -> None:
    if column.name not in _column_names(table):
        op.add_column(table, column)


def upgrade() -> None:
    # Startup create_all can create new tables before this revision is applied,
    # while leaving new columns off tables that already exist.
    _add_column_if_missing(
        "partner_telegram_bots",
        sa.Column("default_warehouse_id", sa.Integer(), nullable=True),
    )
    _add_column_if_missing(
        "partner_telegram_bots",
        sa.Column("default_price_type_id", sa.Integer(), nullable=True),
    )
    _add_column_if_missing(
        "partner_telegram_bots",
        sa.Column(
            "allow_catalog_warehouse_selection",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    _add_column_if_missing(
        "partner_telegram_bots",
        sa.Column(
            "allow_self_registration",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    _add_column_if_missing(
        "partner_telegram_bots",
        sa.Column("default_partner_group_id", sa.Integer(), nullable=True),
    )
    _add_column_if_missing(
        "partner_telegram_accounts",
        sa.Column("warehouse_id", sa.Integer(), nullable=True),
    )
    _add_column_if_missing(
        "partner_telegram_accounts",
        sa.Column("price_type_id", sa.Integer(), nullable=True),
    )
    _add_column_if_missing(
        "partner_telegram_accounts",
        sa.Column("password_hash", sa.String(length=255), nullable=True),
    )
    bind = op.get_bind()
    if not inspect(bind).has_table("partner_telegram_password_codes"):
        op.create_table(
            "partner_telegram_password_codes",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("account_id", sa.Integer(), nullable=False),
            sa.Column("code", sa.String(length=6), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("(CURRENT_TIMESTAMP)"),
                nullable=False,
            ),
            sa.ForeignKeyConstraint(
                ["account_id"], ["partner_telegram_accounts.id"], ondelete="CASCADE"
            ),
            sa.PrimaryKeyConstraint("id"),
        )
    existing_indexes = {
        index["name"]
        for index in inspect(bind).get_indexes("partner_telegram_password_codes")
    }
    index_name = op.f("ix_partner_telegram_password_codes_account_id")
    if index_name not in existing_indexes:
        op.create_index(
            index_name,
            "partner_telegram_password_codes",
            ["account_id"],
            unique=False,
        )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_partner_telegram_password_codes_account_id"),
        table_name="partner_telegram_password_codes",
    )
    op.drop_table("partner_telegram_password_codes")
    op.drop_column("partner_telegram_accounts", "password_hash")
    op.drop_column("partner_telegram_accounts", "price_type_id")
    op.drop_column("partner_telegram_accounts", "warehouse_id")
    op.drop_column("partner_telegram_bots", "default_partner_group_id")
    op.drop_column("partner_telegram_bots", "allow_self_registration")
    op.drop_column("partner_telegram_bots", "allow_catalog_warehouse_selection")
    op.drop_column("partner_telegram_bots", "default_price_type_id")
    op.drop_column("partner_telegram_bots", "default_warehouse_id")
