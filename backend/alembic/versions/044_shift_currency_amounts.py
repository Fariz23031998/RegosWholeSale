"""per-currency shift till amounts and operation currency

Revision ID: 044
Revises: 043
Create Date: 2026-11-22

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision: str = "044"
down_revision: Union[str, None] = "043"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    tables = set(inspector.get_table_names())

    if "shift_currency_amounts" not in tables:
        op.create_table(
            "shift_currency_amounts",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("shift_id", sa.Integer(), nullable=False),
            sa.Column("company_id", sa.Integer(), nullable=False),
            sa.Column("currency_id", sa.Integer(), nullable=False),
            sa.Column("currency_code", sa.String(16), nullable=True),
            sa.Column("start_amount", sa.Numeric(18, 2), nullable=False),
            sa.Column("expected_amount", sa.Numeric(18, 2), nullable=True),
            sa.Column("actual_amount", sa.Numeric(18, 2), nullable=True),
            sa.Column("difference_amount", sa.Numeric(18, 2), nullable=True),
            sa.Column(
                "debt_settled_amount",
                sa.Numeric(18, 2),
                server_default="0",
                nullable=False,
            ),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("(CURRENT_TIMESTAMP)"),
                nullable=False,
            ),
            sa.ForeignKeyConstraint(["shift_id"], ["shifts.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "shift_id",
                "currency_id",
                name="uq_shift_currency_amounts_shift_currency",
            ),
        )
        op.create_index(
            "ix_shift_currency_amounts_shift_id",
            "shift_currency_amounts",
            ["shift_id"],
            unique=False,
        )
        op.create_index(
            op.f("ix_shift_currency_amounts_company_id"),
            "shift_currency_amounts",
            ["company_id"],
            unique=False,
        )

    op_cols = {c["name"] for c in inspector.get_columns("shift_operations")}
    if "currency_id" not in op_cols:
        op.add_column(
            "shift_operations",
            sa.Column("currency_id", sa.Integer(), nullable=True),
        )
    if "currency_code" not in op_cols:
        op.add_column(
            "shift_operations",
            sa.Column("currency_code", sa.String(16), nullable=True),
        )

    # Backfill amount rows from legacy single-currency shift columns.
    op.execute(
        sa.text(
            """
            INSERT INTO shift_currency_amounts (
                shift_id,
                company_id,
                currency_id,
                currency_code,
                start_amount,
                expected_amount,
                actual_amount,
                difference_amount,
                debt_settled_amount
            )
            SELECT
                s.id,
                s.company_id,
                COALESCE(s.currency_id, 0),
                s.currency_code,
                s.start_amount,
                s.expected_amount,
                s.actual_amount,
                s.difference_amount,
                s.debt_settled_amount
            FROM shifts s
            WHERE NOT EXISTS (
                SELECT 1
                FROM shift_currency_amounts a
                WHERE a.shift_id = s.id
            )
            """
        )
    )

    # Backfill operation currency from parent shift.
    op.execute(
        sa.text(
            """
            UPDATE shift_operations
            SET
                currency_id = (
                    SELECT COALESCE(s.currency_id, 0)
                    FROM shifts s
                    WHERE s.id = shift_operations.shift_id
                ),
                currency_code = (
                    SELECT s.currency_code
                    FROM shifts s
                    WHERE s.id = shift_operations.shift_id
                )
            WHERE currency_id IS NULL
            """
        )
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    op_cols = {c["name"] for c in inspector.get_columns("shift_operations")}
    if "currency_code" in op_cols:
        op.drop_column("shift_operations", "currency_code")
    if "currency_id" in op_cols:
        op.drop_column("shift_operations", "currency_id")

    tables = set(inspector.get_table_names())
    if "shift_currency_amounts" in tables:
        op.drop_index(
            "ix_shift_currency_amounts_shift_id",
            table_name="shift_currency_amounts",
        )
        op.drop_index(
            op.f("ix_shift_currency_amounts_company_id"),
            table_name="shift_currency_amounts",
        )
        op.drop_table("shift_currency_amounts")
