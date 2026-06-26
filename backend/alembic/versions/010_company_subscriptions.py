"""company subscriptions

Revision ID: 010
Revises: 009
Create Date: 2026-06-26

"""

from datetime import UTC, datetime
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "010"
down_revision: Union[str, None] = "009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

FAR_FUTURE = datetime(2099, 12, 31, 23, 59, 59, tzinfo=UTC)


def upgrade() -> None:
    subscription_status = sa.Enum(
        "trial", "active", "expired", "suspended", name="subscriptionstatus"
    )
    subscription_status.create(op.get_bind(), checkfirst=True)

    op.add_column(
        "companies",
        sa.Column(
            "subscription_status",
            subscription_status,
            nullable=False,
            server_default="active",
        ),
    )
    op.add_column(
        "companies",
        sa.Column(
            "subscription_expires_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("'2099-12-31 23:59:59'"),
        ),
    )
    op.add_column(
        "companies",
        sa.Column("internal_notes", sa.Text(), nullable=True),
    )

    conn = op.get_bind()
    conn.execute(
        sa.text(
            "UPDATE companies SET subscription_status = 'active', "
            "subscription_expires_at = :expires_at"
        ),
        {"expires_at": FAR_FUTURE},
    )


def downgrade() -> None:
    op.drop_column("companies", "internal_notes")
    op.drop_column("companies", "subscription_expires_at")
    op.drop_column("companies", "subscription_status")
    op.execute("DROP TYPE IF EXISTS subscriptionstatus")
