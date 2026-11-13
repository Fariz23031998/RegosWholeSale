"""subscription checkout orders for Click SaaS renewals

Revision ID: 037
Revises: 036
Create Date: 2026-11-13

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision: str = "037"
down_revision: Union[str, None] = "036"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_names() -> set[str]:
    bind = op.get_bind()
    return set(inspect(bind).get_table_names())


def upgrade() -> None:
    if "subscription_checkout_orders" in _table_names():
        return
    op.create_table(
        "subscription_checkout_orders",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "company_id",
            sa.Integer(),
            sa.ForeignKey("companies.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("currency", sa.String(length=8), nullable=False, server_default="UZS"),
        sa.Column("period_months", sa.Integer(), nullable=False),
        sa.Column("period_days", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="pending"),
        sa.Column("payment_provider", sa.String(length=32), nullable=True),
        sa.Column("payment_transaction_id", sa.String(length=128), nullable=True),
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_subscription_checkout_orders_status",
        "subscription_checkout_orders",
        ["status"],
    )


def downgrade() -> None:
    if "subscription_checkout_orders" not in _table_names():
        return
    op.drop_index(
        "ix_subscription_checkout_orders_status",
        table_name="subscription_checkout_orders",
    )
    op.drop_table("subscription_checkout_orders")
