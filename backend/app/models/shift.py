import enum
from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import (
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.company import Company
    from app.models.user import User


class ShiftStatus(str, enum.Enum):
    open = "open"
    closed = "closed"


class ShiftOperationType(str, enum.Enum):
    cash_out = "cash_out"
    cash_in = "cash_in"
    change_out = "change_out"
    change_in = "change_in"
    other_out = "other_out"
    other_in = "other_in"
    debt_settlement = "debt_settlement"


class Shift(Base, TimestampMixin):
    __tablename__ = "shifts"
    __table_args__ = (
        Index(
            "uq_shifts_one_open_per_user",
            "company_id",
            "user_id",
            unique=True,
            postgresql_where=text("status = 'open'"),
            sqlite_where=text("status = 'open'"),
        ),
        Index("ix_shifts_company_status", "company_id", "status"),
        Index("ix_shifts_company_user", "company_id", "user_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("companies.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    opened_by_user_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    closed_by_user_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    opened_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[ShiftStatus] = mapped_column(
        Enum(
            ShiftStatus,
            name="shiftstatus",
            values_callable=lambda x: [e.value for e in x],
            native_enum=False,
        ),
        nullable=False,
        default=ShiftStatus.open,
    )
    # Legacy scalar columns kept for migration compatibility; source of truth is currency_amounts.
    start_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    currency_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    currency_code: Mapped[str | None] = mapped_column(String(16), nullable=True)
    firm_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    attached_user_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    expected_amount: Mapped[Decimal | None] = mapped_column(Numeric(18, 2), nullable=True)
    actual_amount: Mapped[Decimal | None] = mapped_column(Numeric(18, 2), nullable=True)
    difference_amount: Mapped[Decimal | None] = mapped_column(Numeric(18, 2), nullable=True)
    debt_settled_amount: Mapped[Decimal] = mapped_column(
        Numeric(18, 2),
        nullable=False,
        default=Decimal("0"),
        server_default="0",
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    company: Mapped["Company"] = relationship("Company")
    user: Mapped["User"] = relationship("User", foreign_keys=[user_id])
    opened_by_user: Mapped["User | None"] = relationship("User", foreign_keys=[opened_by_user_id])
    closed_by_user: Mapped["User | None"] = relationship("User", foreign_keys=[closed_by_user_id])
    operations: Mapped[list["ShiftOperation"]] = relationship(
        "ShiftOperation",
        back_populates="shift",
        cascade="all, delete-orphan",
        order_by="ShiftOperation.created_at",
    )
    currency_amounts: Mapped[list["ShiftCurrencyAmount"]] = relationship(
        "ShiftCurrencyAmount",
        back_populates="shift",
        cascade="all, delete-orphan",
        order_by="ShiftCurrencyAmount.currency_id",
    )


class ShiftCurrencyAmount(Base, TimestampMixin):
    __tablename__ = "shift_currency_amounts"
    __table_args__ = (
        UniqueConstraint(
            "shift_id",
            "currency_id",
            name="uq_shift_currency_amounts_shift_currency",
        ),
        Index("ix_shift_currency_amounts_shift_id", "shift_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    shift_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("shifts.id", ondelete="CASCADE"),
        nullable=False,
    )
    company_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("companies.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    currency_id: Mapped[int] = mapped_column(Integer, nullable=False)
    currency_code: Mapped[str | None] = mapped_column(String(16), nullable=True)
    start_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    expected_amount: Mapped[Decimal | None] = mapped_column(Numeric(18, 2), nullable=True)
    actual_amount: Mapped[Decimal | None] = mapped_column(Numeric(18, 2), nullable=True)
    difference_amount: Mapped[Decimal | None] = mapped_column(Numeric(18, 2), nullable=True)
    debt_settled_amount: Mapped[Decimal] = mapped_column(
        Numeric(18, 2),
        nullable=False,
        default=Decimal("0"),
        server_default="0",
    )

    shift: Mapped["Shift"] = relationship("Shift", back_populates="currency_amounts")
    company: Mapped["Company"] = relationship("Company")


class ShiftOperation(Base, TimestampMixin):
    __tablename__ = "shift_operations"
    __table_args__ = (Index("ix_shift_operations_shift_id", "shift_id"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    shift_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("shifts.id", ondelete="CASCADE"),
        nullable=False,
    )
    company_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("companies.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    created_by_user_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    operation_type: Mapped[ShiftOperationType] = mapped_column(
        Enum(
            ShiftOperationType,
            name="shiftoperationtype",
            values_callable=lambda x: [e.value for e in x],
            native_enum=False,
        ),
        nullable=False,
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    currency_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    currency_code: Mapped[str | None] = mapped_column(String(16), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    shift: Mapped["Shift"] = relationship("Shift", back_populates="operations")
    company: Mapped["Company"] = relationship("Company")
    created_by_user: Mapped["User | None"] = relationship(
        "User", foreign_keys=[created_by_user_id]
    )
