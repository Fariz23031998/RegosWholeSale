"""out of stock products

Revision ID: 013
Revises: 012
Create Date: 2026-06-28

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "013"
down_revision: Union[str, None] = "012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "out_of_stock_products",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("product_id", sa.Integer(), nullable=False),
        sa.Column("stock_id", sa.Integer(), nullable=False),
        sa.Column("company_id", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_out_of_stock_products_product_id"),
        "out_of_stock_products",
        ["product_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_out_of_stock_products_stock_id"),
        "out_of_stock_products",
        ["stock_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_out_of_stock_products_company_id"),
        "out_of_stock_products",
        ["company_id"],
        unique=False,
    )
    op.create_index(
        "ix_out_of_stock_products_company_created",
        "out_of_stock_products",
        ["company_id", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_out_of_stock_products_company_created", table_name="out_of_stock_products")
    op.drop_index(op.f("ix_out_of_stock_products_company_id"), table_name="out_of_stock_products")
    op.drop_index(op.f("ix_out_of_stock_products_stock_id"), table_name="out_of_stock_products")
    op.drop_index(op.f("ix_out_of_stock_products_product_id"), table_name="out_of_stock_products")
    op.drop_table("out_of_stock_products")
