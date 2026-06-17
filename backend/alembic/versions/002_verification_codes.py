"""verification codes table

Revision ID: 002
Revises: 001
Create Date: 2026-05-17

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "verification_codes",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("recipient", sa.String(length=255), nullable=False),
        sa.Column("code", sa.String(length=6), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_verification_codes_recipient"), "verification_codes", ["recipient"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_verification_codes_recipient"), table_name="verification_codes")
    op.drop_table("verification_codes")
