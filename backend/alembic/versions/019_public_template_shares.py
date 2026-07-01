"""public template shares

Revision ID: 019
Revises: 018
Create Date: 2026-07-02

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "019"
down_revision: Union[str, None] = "018"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("receipt_shares") as batch_op:
        batch_op.add_column(
            sa.Column("is_public", sa.Boolean(), nullable=False, server_default=sa.true())
        )
        batch_op.add_column(sa.Column("template_snapshot", sa.JSON(), nullable=True))
        batch_op.add_column(sa.Column("render_context", sa.JSON(), nullable=True))
        batch_op.alter_column("storage_path", existing_type=sa.String(length=512), nullable=True)
        batch_op.alter_column("filename", existing_type=sa.String(length=255), nullable=True)
        batch_op.alter_column("file_size", existing_type=sa.Integer(), nullable=True)


def downgrade() -> None:
    with op.batch_alter_table("receipt_shares") as batch_op:
        batch_op.alter_column("file_size", existing_type=sa.Integer(), nullable=False)
        batch_op.alter_column("filename", existing_type=sa.String(length=255), nullable=False)
        batch_op.alter_column("storage_path", existing_type=sa.String(length=512), nullable=False)
        batch_op.drop_column("render_context")
        batch_op.drop_column("template_snapshot")
        batch_op.drop_column("is_public")
