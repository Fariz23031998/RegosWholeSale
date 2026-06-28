"""platform admin username

Revision ID: 015
Revises: 014
Create Date: 2026-06-29

"""

import re
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "015"
down_revision: Union[str, None] = "014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _slugify_username(value: str) -> str:
    slug = re.sub(r"[^a-z0-9_-]+", "-", value.lower()).strip("-_")
    return (slug or "admin")[:64]


def upgrade() -> None:
    op.add_column("platform_admins", sa.Column("username", sa.String(length=64), nullable=True))

    conn = op.get_bind()
    rows = conn.execute(
        sa.text("SELECT id, email, display_name FROM platform_admins ORDER BY id")
    ).fetchall()
    used: set[str] = set()
    for row in rows:
        admin_id, email, display_name = row
        base = _slugify_username(display_name) or _slugify_username(email.split("@", 1)[0])
        candidate = base
        suffix = 2
        while candidate in used:
            candidate = f"{base[:60]}-{suffix}"
            suffix += 1
        used.add(candidate)
        conn.execute(
            sa.text("UPDATE platform_admins SET username = :username WHERE id = :id"),
            {"username": candidate, "id": admin_id},
        )

    with op.batch_alter_table("platform_admins", schema=None) as batch_op:
        batch_op.alter_column("username", existing_type=sa.String(length=64), nullable=False)
        batch_op.create_index(batch_op.f("ix_platform_admins_username"), ["username"], unique=True)


def downgrade() -> None:
    op.drop_index(op.f("ix_platform_admins_username"), table_name="platform_admins")
    op.drop_column("platform_admins", "username")
