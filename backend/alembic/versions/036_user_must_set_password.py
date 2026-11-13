"""users.must_set_password for Regos catalog login

Revision ID: 036
Revises: 035
Create Date: 2026-11-13

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision: str = "036"
down_revision: Union[str, None] = "035"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_names(table: str) -> set[str]:
    bind = op.get_bind()
    return {column["name"] for column in inspect(bind).get_columns(table)}


def upgrade() -> None:
    columns = _column_names("users")
    if "must_set_password" not in columns:
        op.add_column(
            "users",
            sa.Column(
                "must_set_password",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            ),
        )


def downgrade() -> None:
    columns = _column_names("users")
    if "must_set_password" in columns:
        op.drop_column("users", "must_set_password")
