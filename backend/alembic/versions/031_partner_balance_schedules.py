"""partner bot balance notification schedules array

Revision ID: 031
Revises: 030
Create Date: 2026-11-11

"""

from __future__ import annotations

import json
import uuid
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision: str = "031"
down_revision: Union[str, None] = "030"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_names(table: str) -> set[str]:
    bind = op.get_bind()
    return {column["name"] for column in inspect(bind).get_columns(table)}


def upgrade() -> None:
    columns = _column_names("partner_telegram_bots")
    if "balance_notify_schedules" not in columns:
        op.add_column(
            "partner_telegram_bots",
            sa.Column(
                "balance_notify_schedules",
                sa.JSON(),
                nullable=False,
                server_default=sa.text("'[]'"),
            ),
        )

    columns = _column_names("partner_telegram_bots")
    has_legacy = all(
        name in columns
        for name in (
            "balance_notify_time",
            "balance_notify_option",
            "balance_notify_days",
            "balance_notify_last_slot",
        )
    )
    if has_legacy:
        bind = op.get_bind()
        rows = bind.execute(
            sa.text(
                """
                SELECT id, balance_notify_time, balance_notify_option,
                       balance_notify_days, balance_notify_last_slot
                FROM partner_telegram_bots
                """
            )
        ).fetchall()
        for row in rows:
            days = row[3]
            if isinstance(days, str):
                try:
                    days = json.loads(days)
                except json.JSONDecodeError:
                    days = []
            if not isinstance(days, list):
                days = []
            normalized_days: list[int] = []
            for item in days:
                if isinstance(item, bool):
                    continue
                try:
                    normalized_days.append(int(item))
                except (TypeError, ValueError):
                    continue
            option = row[2] if row[2] in {"daily", "weekdays", "monthly"} else "daily"
            if option == "daily":
                normalized_days = []
            schedule = {
                "id": str(uuid.uuid4()),
                "time": row[1] or "09:00",
                "option": option,
                "days": normalized_days,
                "last_slot": row[4],
            }
            bind.execute(
                sa.text(
                    """
                    UPDATE partner_telegram_bots
                    SET balance_notify_schedules = :schedules
                    WHERE id = :id
                    """
                ),
                {"schedules": json.dumps([schedule]), "id": row[0]},
            )

        for name in (
            "balance_notify_last_slot",
            "balance_notify_days",
            "balance_notify_option",
            "balance_notify_time",
        ):
            if name in _column_names("partner_telegram_bots"):
                op.drop_column("partner_telegram_bots", name)


def downgrade() -> None:
    columns = _column_names("partner_telegram_bots")
    if "balance_notify_time" not in columns:
        op.add_column(
            "partner_telegram_bots",
            sa.Column(
                "balance_notify_time",
                sa.String(length=5),
                nullable=False,
                server_default="09:00",
            ),
        )
    if "balance_notify_option" not in columns:
        op.add_column(
            "partner_telegram_bots",
            sa.Column(
                "balance_notify_option",
                sa.String(length=16),
                nullable=False,
                server_default="daily",
            ),
        )
    if "balance_notify_days" not in columns:
        op.add_column(
            "partner_telegram_bots",
            sa.Column(
                "balance_notify_days",
                sa.JSON(),
                nullable=False,
                server_default=sa.text("'[]'"),
            ),
        )
    if "balance_notify_last_slot" not in columns:
        op.add_column(
            "partner_telegram_bots",
            sa.Column("balance_notify_last_slot", sa.String(length=32), nullable=True),
        )

    columns = _column_names("partner_telegram_bots")
    if "balance_notify_schedules" in columns:
        bind = op.get_bind()
        rows = bind.execute(
            sa.text("SELECT id, balance_notify_schedules FROM partner_telegram_bots")
        ).fetchall()
        for row in rows:
            schedules = row[1]
            if isinstance(schedules, str):
                try:
                    schedules = json.loads(schedules)
                except json.JSONDecodeError:
                    schedules = []
            first = schedules[0] if isinstance(schedules, list) and schedules else {}
            if not isinstance(first, dict):
                first = {}
            time_hhmm = first.get("time") if isinstance(first.get("time"), str) else "09:00"
            option = first.get("option") if first.get("option") in {"daily", "weekdays", "monthly"} else "daily"
            days = first.get("days") if isinstance(first.get("days"), list) else []
            last_slot = first.get("last_slot") if isinstance(first.get("last_slot"), str) else None
            bind.execute(
                sa.text(
                    """
                    UPDATE partner_telegram_bots
                    SET balance_notify_time = :time,
                        balance_notify_option = :option,
                        balance_notify_days = :days,
                        balance_notify_last_slot = :last_slot
                    WHERE id = :id
                    """
                ),
                {
                    "time": time_hhmm or "09:00",
                    "option": option,
                    "days": json.dumps(days),
                    "last_slot": last_slot,
                    "id": row[0],
                },
            )
        op.drop_column("partner_telegram_bots", "balance_notify_schedules")
