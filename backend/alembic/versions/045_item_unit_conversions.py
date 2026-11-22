"""per-item unit conversions replace company unit conversions

Revision ID: 045
Revises: 044
Create Date: 2026-11-22

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision: str = "045"
down_revision: Union[str, None] = "044"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    tables = set(inspector.get_table_names())

    if "unit_conversions" in tables:
        indexes = {idx["name"] for idx in inspector.get_indexes("unit_conversions")}
        if "ix_unit_conversions_price_type_id" in indexes:
            op.drop_index(
                op.f("ix_unit_conversions_price_type_id"),
                table_name="unit_conversions",
            )
        if "ix_unit_conversions_secondary_unit_id" in indexes:
            op.drop_index(
                op.f("ix_unit_conversions_secondary_unit_id"),
                table_name="unit_conversions",
            )
        if "ix_unit_conversions_main_unit_id" in indexes:
            op.drop_index(
                op.f("ix_unit_conversions_main_unit_id"),
                table_name="unit_conversions",
            )
        if "ix_unit_conversions_company_id" in indexes:
            op.drop_index(
                op.f("ix_unit_conversions_company_id"),
                table_name="unit_conversions",
            )
        op.drop_table("unit_conversions")

    if "item_unit_conversions" not in tables:
        op.create_table(
            "item_unit_conversions",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("company_id", sa.Integer(), nullable=False),
            sa.Column("regos_item_id", sa.Integer(), nullable=False),
            sa.Column("secondary_unit_id", sa.Integer(), nullable=False),
            sa.Column("conversion_factor", sa.Numeric(18, 6), nullable=False),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("(CURRENT_TIMESTAMP)"),
                nullable=False,
            ),
            sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "company_id",
                "regos_item_id",
                name="uq_item_unit_conversions_company_item",
            ),
        )
        op.create_index(
            op.f("ix_item_unit_conversions_company_id"),
            "item_unit_conversions",
            ["company_id"],
            unique=False,
        )
        op.create_index(
            op.f("ix_item_unit_conversions_regos_item_id"),
            "item_unit_conversions",
            ["regos_item_id"],
            unique=False,
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    tables = set(inspector.get_table_names())

    if "item_unit_conversions" in tables:
        op.drop_index(
            op.f("ix_item_unit_conversions_regos_item_id"),
            table_name="item_unit_conversions",
        )
        op.drop_index(
            op.f("ix_item_unit_conversions_company_id"),
            table_name="item_unit_conversions",
        )
        op.drop_table("item_unit_conversions")

    if "unit_conversions" not in tables:
        op.create_table(
            "unit_conversions",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("company_id", sa.Integer(), nullable=False),
            sa.Column("main_unit_id", sa.Integer(), nullable=False),
            sa.Column("secondary_unit_id", sa.Integer(), nullable=False),
            sa.Column("conversion_factor", sa.Numeric(18, 6), nullable=False),
            sa.Column("price_type_id", sa.Integer(), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("(CURRENT_TIMESTAMP)"),
                nullable=False,
            ),
            sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "company_id",
                "main_unit_id",
                "secondary_unit_id",
                name="uq_unit_conversions_company_main_secondary",
            ),
        )
        op.create_index(
            op.f("ix_unit_conversions_company_id"),
            "unit_conversions",
            ["company_id"],
            unique=False,
        )
        op.create_index(
            op.f("ix_unit_conversions_main_unit_id"),
            "unit_conversions",
            ["main_unit_id"],
            unique=False,
        )
        op.create_index(
            op.f("ix_unit_conversions_secondary_unit_id"),
            "unit_conversions",
            ["secondary_unit_id"],
            unique=False,
        )
        op.create_index(
            op.f("ix_unit_conversions_price_type_id"),
            "unit_conversions",
            ["price_type_id"],
            unique=False,
        )
