from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field

ShiftStatus = Literal["open", "closed"]
ShiftOperationType = Literal[
    "cash_out",
    "cash_in",
    "change_out",
    "change_in",
    "other_out",
    "other_in",
    "debt_settlement",
]


class ShiftCurrencyAmountInput(BaseModel):
    currency_id: int = Field(..., ge=1)
    amount: Decimal = Field(..., ge=0)


class ShiftCurrencyAmountResponse(BaseModel):
    currency_id: int
    currency_code: str | None = None
    start_amount: Decimal
    expected_amount: Decimal | None = None
    actual_amount: Decimal | None = None
    difference_amount: Decimal | None = None
    debt_settled_amount: Decimal = Decimal("0")
    outstanding_debt: Decimal = Decimal("0")


class ShiftExpectedCurrencyBreakdown(BaseModel):
    currency_id: int
    currency_code: str | None = None
    start_amount: Decimal
    cash_from_docs: Decimal
    ops_net: Decimal
    expected_amount: Decimal


class ShiftExpectedBreakdown(BaseModel):
    docs_count: int = 0
    by_currency: list[ShiftExpectedCurrencyBreakdown] = Field(default_factory=list)


class ShiftOperationResponse(BaseModel):
    id: int
    shift_id: int
    created_by_user_id: int | None = None
    created_by_display_name: str | None = None
    operation_type: ShiftOperationType
    amount: Decimal
    currency_id: int | None = None
    currency_code: str | None = None
    note: str | None = None
    created_at: datetime


class ShiftResponse(BaseModel):
    id: int
    company_id: int
    user_id: int
    user_display_name: str | None = None
    opened_by_user_id: int | None = None
    closed_by_user_id: int | None = None
    opened_at: datetime
    closed_at: datetime | None = None
    status: ShiftStatus
    firm_id: int | None = None
    attached_user_id: int | None = None
    notes: str | None = None
    currency_amounts: list[ShiftCurrencyAmountResponse] = Field(default_factory=list)
    operations: list[ShiftOperationResponse] = Field(default_factory=list)
    expected_preview: ShiftExpectedBreakdown | None = None


class ShiftListResponse(BaseModel):
    shifts: list[ShiftResponse]
    total: int


class ShiftOpenRequest(BaseModel):
    amounts: list[ShiftCurrencyAmountInput] = Field(..., min_length=1)
    notes: str | None = None
    user_id: int | None = Field(default=None, ge=1)


class ShiftCloseRequest(BaseModel):
    amounts: list[ShiftCurrencyAmountInput] = Field(..., min_length=1)
    notes: str | None = None


class ShiftOperationCreateRequest(BaseModel):
    operation_type: ShiftOperationType
    amount: Decimal = Field(..., gt=0)
    currency_id: int = Field(..., ge=1)
    note: str | None = None


class EmployeeDebtCurrencyAmount(BaseModel):
    currency_id: int
    currency_code: str | None = None
    amount: Decimal


class EmployeeDebtResponse(BaseModel):
    user_id: int
    user_display_name: str | None = None
    outstanding_debt_by_currency: list[EmployeeDebtCurrencyAmount] = Field(
        default_factory=list
    )
