"""receipt shares

Revision ID: 018
Revises: 017
Create Date: 2026-07-01

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "018"
down_revision: Union[str, None] = "017"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "receipt_shares",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("token", sa.String(length=36), nullable=False),
        sa.Column("company_id", sa.Integer(), nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.Column("storage_path", sa.String(length=512), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("file_size", sa.Integer(), nullable=False),
        sa.Column("document_code", sa.String(length=120), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("download_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_receipt_shares_token"), "receipt_shares", ["token"], unique=True)
    op.create_index(op.f("ix_receipt_shares_company_id"), "receipt_shares", ["company_id"])
    op.create_index("ix_receipt_shares_expires_at", "receipt_shares", ["expires_at"])
    op.create_index(
        "ix_receipt_shares_company_created",
        "receipt_shares",
        ["company_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_receipt_shares_company_created", table_name="receipt_shares")
    op.drop_index("ix_receipt_shares_expires_at", table_name="receipt_shares")
    op.drop_index(op.f("ix_receipt_shares_company_id"), table_name="receipt_shares")
    op.drop_index(op.f("ix_receipt_shares_token"), table_name="receipt_shares")
    op.drop_table("receipt_shares")
