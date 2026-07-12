"""Copy data from a SQLite database into PostgreSQL.

Prerequisites:
  - Destination schema already at Alembic head (`alembic upgrade head`)
  - Destination data tables empty (or pass `--force` to truncate first)

Usage:
  python -m scripts.migrate_sqlite_to_postgres \\
    --sqlite-path ./data/regos.db \\
    --postgres-url postgresql+asyncpg://regos:PASSWORD@127.0.0.1:5432/regos
"""

from __future__ import annotations

import argparse
import asyncio
import json
from datetime import datetime, time, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import Boolean, DateTime, JSON, Table, func, select, text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, create_async_engine

# Import models so Base.metadata is fully populated.
import app.models  # noqa: F401
from app.models.base import Base

EXPECTED_ALEMBIC_HEAD = "020"

# FK-safe copy order. alembic_version is intentionally omitted.
TABLE_ORDER: tuple[str, ...] = (
    "companies",
    "permissions",
    "platform_admins",
    "users",
    "user_permissions",
    "login_schedules",
    "user_settings",
    "verification_codes",
    "regos_tokens",
    "user_featured_products",
    "telegram_bots",
    "telegram_users",
    "out_of_stock_products",
    "subscription_payments",
    "receipt_shares",
    "events_log",
)

BATCH_SIZE = 500


def _sqlite_url(path: Path) -> str:
    resolved = path.resolve().as_posix()
    return f"sqlite+aiosqlite:///{resolved}"


def _is_bool_column(column) -> bool:  # noqa: ANN001
    return isinstance(column.type, Boolean)


def _is_json_column(column) -> bool:  # noqa: ANN001
    return isinstance(column.type, JSON)


def _is_datetime_column(column) -> bool:  # noqa: ANN001
    return isinstance(column.type, DateTime)


def _coerce_bool(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"1", "true", "t", "yes"}:
            return True
        if lowered in {"0", "false", "f", "no"}:
            return False
    return bool(value)


def _coerce_json(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, (bytes, bytearray)):
        value = value.decode("utf-8")
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return None
        return json.loads(stripped)
    return value


def _coerce_datetime(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value
    if isinstance(value, str):
        normalized = value.replace("Z", "+00:00")
        parsed = datetime.fromisoformat(normalized)
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed
    return value


def _coerce_time(value: Any) -> Any:
    if value is None or isinstance(value, time):
        return value
    if isinstance(value, str):
        parts = value.split(":")
        if len(parts) >= 2:
            hour = int(parts[0])
            minute = int(parts[1])
            second = int(float(parts[2])) if len(parts) > 2 else 0
            return time(hour, minute, second)
    return value


def _coerce_row(table: Table, row: dict[str, Any]) -> dict[str, Any]:
    coerced: dict[str, Any] = {}
    for column in table.columns:
        name = column.name
        if name not in row:
            continue
        value = row[name]
        if _is_bool_column(column):
            value = _coerce_bool(value)
        elif _is_json_column(column):
            value = _coerce_json(value)
        elif _is_datetime_column(column):
            value = _coerce_datetime(value)
        elif name in {"start_time", "end_time"}:
            value = _coerce_time(value)
        coerced[name] = value
    return coerced


async def _alembic_version(session: AsyncSession) -> str | None:
    exists = await session.scalar(
        text(
            "SELECT 1 FROM information_schema.tables "
            "WHERE table_schema = 'public' AND table_name = 'alembic_version'"
        )
    )
    if not exists:
        return None
    return await session.scalar(text("SELECT version_num FROM alembic_version LIMIT 1"))


async def _sqlite_table_exists(session: AsyncSession, table_name: str) -> bool:
    exists = await session.scalar(
        text("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = :name"),
        {"name": table_name},
    )
    return bool(exists)


async def _table_count(session: AsyncSession, table: Table) -> int:
    return int(await session.scalar(select(func.count()).select_from(table)) or 0)


async def _any_data_tables_nonempty(session: AsyncSession, tables: list[Table]) -> list[str]:
    nonempty: list[str] = []
    for table in tables:
        if await _table_count(session, table) > 0:
            nonempty.append(table.name)
    return nonempty


async def _truncate_tables(session: AsyncSession, tables: list[Table]) -> None:
    names = ", ".join(f'"{t.name}"' for t in reversed(tables))
    await session.execute(text(f"TRUNCATE TABLE {names} RESTART IDENTITY CASCADE"))
    await session.commit()


async def _reset_id_sequence(session: AsyncSession, table_name: str) -> None:
    # table_name comes only from TABLE_ORDER.
    await session.execute(
        text(
            f"""
            DO $$
            DECLARE
                seq regclass;
            BEGIN
                seq := pg_get_serial_sequence('{table_name}', 'id');
                IF seq IS NOT NULL THEN
                    EXECUTE format(
                        'SELECT setval(%L, COALESCE((SELECT MAX(id) FROM %I), 1), true)',
                        seq::text,
                        '{table_name}'
                    );
                END IF;
            END $$;
            """
        )
    )


async def _copy_table(
    source: AsyncSession,
    dest: AsyncSession,
    table: Table,
) -> tuple[int, int, bool]:
    """Returns (source_count, dest_count, skipped_missing)."""
    if not await _sqlite_table_exists(source, table.name):
        return 0, await _table_count(dest, table), True

    source_count = int(
        await source.scalar(text(f'SELECT COUNT(*) FROM "{table.name}"')) or 0
    )
    if source_count == 0:
        return 0, 0, False

    # SELECT * so older SQLite schemas missing newer columns still work.
    offset = 0
    while offset < source_count:
        rows = (
            await source.execute(
                text(f'SELECT * FROM "{table.name}" LIMIT :limit OFFSET :offset'),
                {"limit": BATCH_SIZE, "offset": offset},
            )
        ).mappings().all()
        if not rows:
            break
        payloads = [_coerce_row(table, dict(row)) for row in rows]
        await dest.execute(table.insert(), payloads)
        offset += len(payloads)

    await dest.commit()
    await _reset_id_sequence(dest, table.name)
    await dest.commit()

    dest_count = await _table_count(dest, table)
    return source_count, dest_count, False


async def migrate(
    *,
    sqlite_path: Path,
    postgres_url: str,
    force: bool,
    expected_head: str,
) -> None:
    if not sqlite_path.is_file():
        raise SystemExit(f"SQLite file not found: {sqlite_path}")
    if not postgres_url.startswith("postgresql"):
        raise SystemExit("postgres-url must start with postgresql+asyncpg:// or postgresql://")
    if postgres_url.startswith("postgresql://"):
        postgres_url = postgres_url.replace("postgresql://", "postgresql+asyncpg://", 1)

    metadata = Base.metadata
    missing = [name for name in TABLE_ORDER if name not in metadata.tables]
    if missing:
        raise SystemExit(f"Models missing tables: {', '.join(missing)}")

    tables = [metadata.tables[name] for name in TABLE_ORDER]

    source_engine: AsyncEngine = create_async_engine(_sqlite_url(sqlite_path), echo=False)
    dest_engine: AsyncEngine = create_async_engine(
        postgres_url,
        echo=False,
        pool_pre_ping=True,
    )

    try:
        async with source_engine.connect() as source_conn, dest_engine.connect() as dest_conn:
            source_session = AsyncSession(source_conn, expire_on_commit=False)
            dest_session = AsyncSession(dest_conn, expire_on_commit=False)

            version = await _alembic_version(dest_session)
            if version != expected_head:
                raise SystemExit(
                    f"Postgres alembic_version is {version!r}, expected {expected_head!r}. "
                    "Run `alembic upgrade head` against the destination first."
                )

            nonempty = await _any_data_tables_nonempty(dest_session, tables)
            if nonempty and not force:
                raise SystemExit(
                    "Destination has data in: "
                    + ", ".join(nonempty)
                    + ". Re-run with --force to truncate those tables first."
                )
            if nonempty and force:
                print(f"Truncating {len(nonempty)} nonempty table(s) (--force)...")
                await _truncate_tables(dest_session, tables)

            print(f"Copying {len(tables)} tables from {sqlite_path} -> Postgres...")
            mismatches: list[str] = []
            for table in tables:
                src_count, dst_count, skipped = await _copy_table(
                    source_session, dest_session, table
                )
                if skipped:
                    print(f"  {table.name}: skipped (missing in SQLite)")
                    continue
                status = "ok" if src_count == dst_count else "MISMATCH"
                print(f"  {table.name}: sqlite={src_count} postgres={dst_count} [{status}]")
                if src_count != dst_count:
                    mismatches.append(table.name)

            if mismatches:
                raise SystemExit(f"Row count mismatch for: {', '.join(mismatches)}")

            print("Migration completed successfully.")
    finally:
        await source_engine.dispose()
        await dest_engine.dispose()


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Migrate Regos SQLite data into PostgreSQL.")
    parser.add_argument(
        "--sqlite-path",
        type=Path,
        default=Path("./data/regos.db"),
        help="Path to source SQLite database file",
    )
    parser.add_argument(
        "--postgres-url",
        required=True,
        help="Destination URL, e.g. postgresql+asyncpg://regos:pass@127.0.0.1:5432/regos",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Truncate destination data tables before copy (dangerous)",
    )
    parser.add_argument(
        "--expected-head",
        default=EXPECTED_ALEMBIC_HEAD,
        help=f"Required alembic_version on destination (default: {EXPECTED_ALEMBIC_HEAD})",
    )
    args = parser.parse_args(argv)
    asyncio.run(
        migrate(
            sqlite_path=args.sqlite_path,
            postgres_url=args.postgres_url,
            force=args.force,
            expected_head=args.expected_head,
        )
    )


if __name__ == "__main__":
    main()
