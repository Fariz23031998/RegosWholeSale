"""shift management and cash control tables

Revision ID: 043
Revises: 042
Create Date: 2026-11-22

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision: str = "043"
down_revision: Union[str, None] = "042"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    tables = set(inspector.get_table_names())

    if "shifts" not in tables:
        op.create_table(
            "shifts",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("company_id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("opened_by_user_id", sa.Integer(), nullable=True),
            sa.Column("closed_by_user_id", sa.Integer(), nullable=True),
            sa.Column(
                "opened_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("(CURRENT_TIMESTAMP)"),
                nullable=False,
            ),
            sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("status", sa.String(16), nullable=False),
            sa.Column("start_amount", sa.Numeric(18, 2), nullable=False),
            sa.Column("currency_id", sa.Integer(), nullable=True),
            sa.Column("currency_code", sa.String(16), nullable=True),
            sa.Column("firm_id", sa.Integer(), nullable=True),
            sa.Column("attached_user_id", sa.Integer(), nullable=True),
            sa.Column("expected_amount", sa.Numeric(18, 2), nullable=True),
            sa.Column("actual_amount", sa.Numeric(18, 2), nullable=True),
            sa.Column("difference_amount", sa.Numeric(18, 2), nullable=True),
            sa.Column(
                "debt_settled_amount",
                sa.Numeric(18, 2),
                server_default="0",
                nullable=False,
            ),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("(CURRENT_TIMESTAMP)"),
                nullable=False,
            ),
            sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["opened_by_user_id"], ["users.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["closed_by_user_id"], ["users.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(op.f("ix_shifts_company_id"), "shifts", ["company_id"], unique=False)
        op.create_index(op.f("ix_shifts_user_id"), "shifts", ["user_id"], unique=False)
        op.create_index(
            "ix_shifts_company_status",
            "shifts",
            ["company_id", "status"],
            unique=False,
        )
        op.create_index(
            "ix_shifts_company_user",
            "shifts",
            ["company_id", "user_id"],
            unique=False,
        )
        op.create_index(
            "uq_shifts_one_open_per_user",
            "shifts",
            ["company_id", "user_id"],
            unique=True,
            sqlite_where=sa.text("status = 'open'"),
            postgresql_where=sa.text("status = 'open'"),
        )

    if "shift_operations" not in tables:
        op.create_table(
            "shift_operations",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("shift_id", sa.Integer(), nullable=False),
            sa.Column("company_id", sa.Integer(), nullable=False),
            sa.Column("created_by_user_id", sa.Integer(), nullable=True),
            sa.Column("operation_type", sa.String(32), nullable=False),
            sa.Column("amount", sa.Numeric(18, 2), nullable=False),
            sa.Column("note", sa.Text(), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("(CURRENT_TIMESTAMP)"),
                nullable=False,
            ),
            sa.ForeignKeyConstraint(["shift_id"], ["shifts.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(
            op.f("ix_shift_operations_company_id"),
            "shift_operations",
            ["company_id"],
            unique=False,
        )
        op.create_index(
            "ix_shift_operations_shift_id",
            "shift_operations",
            ["shift_id"],
            unique=False,
        )


def downgrade() -> None:
    op.drop_index("ix_shift_operations_shift_id", table_name="shift_operations")
    op.drop_index(op.f("ix_shift_operations_company_id"), table_name="shift_operations")
    op.drop_table("shift_operations")
    op.drop_index("uq_shifts_one_open_per_user", table_name="shifts")
    op.drop_index("ix_shifts_company_user", table_name="shifts")
    op.drop_index("ix_shifts_company_status", table_name="shifts")
    op.drop_index(op.f("ix_shifts_user_id"), table_name="shifts")
    op.drop_index(op.f("ix_shifts_company_id"), table_name="shifts")
    op.drop_table("shifts")
