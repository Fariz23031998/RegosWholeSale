"""permission effects and granular pos permissions

Revision ID: 009
Revises: 008
Create Date: 2026-06-26

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "009"
down_revision: Union[str, None] = "008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NEW_PERMISSIONS = [
    ("pos.change_warehouse", "Change selected warehouse on sell screen"),
    ("pos.change_price_type", "Change selected price type on sell screen"),
    ("pos.change_partner", "Change selected customer or partner on sell screen"),
    ("pos.apply_discount", "Apply discounts on sales"),
    ("pos.modify_price", "Modify product prices on sales"),
    ("sales.postpone", "Postpone sales"),
    ("sales.continue", "Continue postponed sales"),
    ("documents.print", "Print receipts, invoices, and documents"),
]

SPLIT_FROM_OVERRIDE = [
    "pos.change_warehouse",
    "pos.change_price_type",
    "pos.change_partner",
]


def upgrade() -> None:
    op.add_column(
        "user_permissions",
        sa.Column(
            "effect",
            sa.Enum("allow", "deny", name="permissioneffect"),
            nullable=False,
            server_default="allow",
        ),
    )

    conn = op.get_bind()
    permissions = sa.table(
        "permissions",
        sa.column("id", sa.Integer),
        sa.column("code", sa.String),
        sa.column("description", sa.String),
    )
    user_permissions = sa.table(
        "user_permissions",
        sa.column("id", sa.Integer),
        sa.column("user_id", sa.Integer),
        sa.column("permission_id", sa.Integer),
        sa.column("effect", sa.String),
    )
    users = sa.table(
        "users",
        sa.column("id", sa.Integer),
        sa.column("role", sa.String),
    )

    existing_codes = {
        row.code: row.id
        for row in conn.execute(sa.select(permissions.c.id, permissions.c.code))
    }

    for code, description in NEW_PERMISSIONS:
        if code not in existing_codes:
            result = conn.execute(
                sa.insert(permissions).values(code=code, description=description)
            )
            existing_codes[code] = result.inserted_primary_key[0]

    override_id = existing_codes.get("pos.override_regos")
    if override_id is not None:
        employee_rows = conn.execute(
            sa.select(user_permissions.c.user_id)
            .select_from(
                user_permissions.join(users, users.c.id == user_permissions.c.user_id)
            )
            .where(
                user_permissions.c.permission_id == override_id,
                users.c.role == "employee",
            )
        ).fetchall()

        for row in employee_rows:
            user_id = row.user_id
            conn.execute(
                sa.delete(user_permissions).where(
                    user_permissions.c.user_id == user_id,
                    user_permissions.c.permission_id == override_id,
                )
            )
            for code in SPLIT_FROM_OVERRIDE:
                perm_id = existing_codes.get(code)
                if perm_id is None:
                    continue
                existing = conn.execute(
                    sa.select(user_permissions.c.id).where(
                        user_permissions.c.user_id == user_id,
                        user_permissions.c.permission_id == perm_id,
                    )
                ).first()
                if existing is None:
                    conn.execute(
                        sa.insert(user_permissions).values(
                            user_id=user_id,
                            permission_id=perm_id,
                            effect="allow",
                        )
                    )


def downgrade() -> None:
    op.drop_column("user_permissions", "effect")
    op.execute("DROP TYPE IF EXISTS permissioneffect")
