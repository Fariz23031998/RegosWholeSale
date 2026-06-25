"""global unique login

Revision ID: 006
Revises: 005
Create Date: 2026-06-22

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "006"
down_revision: Union[str, None] = "005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    duplicates = conn.execute(
        sa.text(
            """
            SELECT login, COUNT(*) AS cnt
            FROM users
            WHERE login IS NOT NULL
            GROUP BY login
            HAVING COUNT(*) > 1
            """
        )
    ).fetchall()
    if duplicates:
        names = ", ".join(row[0] for row in duplicates)
        raise RuntimeError(
            f"Cannot migrate: duplicate logins exist across companies: {names}. "
            "Rename duplicates before running this migration."
        )

    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_constraint("uq_users_company_login", type_="unique")
        batch_op.create_index(batch_op.f("ix_users_login"), ["login"], unique=True)


def downgrade() -> None:
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_users_login"))
        batch_op.create_unique_constraint("uq_users_company_login", ["company_id", "login"])
