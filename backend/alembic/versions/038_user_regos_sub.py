"""users.regos_sub for REGOS SSO account linking

Revision ID: 038
Revises: 037
Create Date: 2026-11-14

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision: str = "038"
down_revision: Union[str, None] = "037"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_names(table: str) -> set[str]:
    bind = op.get_bind()
    return {column["name"] for column in inspect(bind).get_columns(table)}


def _index_names(table: str) -> set[str]:
    bind = op.get_bind()
    return {index["name"] for index in inspect(bind).get_indexes(table)}


def upgrade() -> None:
    columns = _column_names("users")
    if "regos_sub" not in columns:
        op.add_column(
            "users",
            sa.Column("regos_sub", sa.String(length=255), nullable=True),
        )

    indexes = _index_names("users")
    if "ix_users_regos_sub" not in indexes:
        op.create_index("ix_users_regos_sub", "users", ["regos_sub"], unique=True)


def downgrade() -> None:
    indexes = _index_names("users")
    if "ix_users_regos_sub" in indexes:
        op.drop_index("ix_users_regos_sub", table_name="users")

    columns = _column_names("users")
    if "regos_sub" in columns:
        op.drop_column("users", "regos_sub")
