from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.settings import RegosCurrencyOption


class PaymentDocument(BaseModel):
    id: int
    code: str
    date: int
    amount: float | None = None
    category_id: int | None = None
    category_name: str | None = None
    payment_type_id: int | None = None
    payment_type_name: str | None = None
    partner_id: int | None = None
    partner_name: str | None = None
    firm_id: int | None = None
    firm_name: str | None = None
    attached_user_id: int | None = None
    attached_user_name: str | None = None
    exchange_rate: float | None = None
    description: str | None = None
    performed: bool = False
    deleted_mark: bool = False
    payment_direction: Literal["income", "outcome"] | None = None
    currency: RegosCurrencyOption | None = None


class PaymentsListResponse(BaseModel):
    documents: list[PaymentDocument]
    next_offset: int = 0
    total: int = 0


class PaymentCreateRequest(BaseModel):
    firm_id: int = Field(ge=1)
    partner_id: int = Field(ge=1)
    direction: Literal["income", "outcome"]
    payment_type_id: int = Field(ge=1)
    amount: float = Field(gt=0)
    exchange_rate: float | None = Field(default=None, gt=0)
    category_id: int | None = Field(default=None, ge=1)
    description: str | None = Field(default=None, max_length=1000)
    date: int | None = Field(default=None, ge=0)


class PaymentEditRequest(BaseModel):
    firm_id: int | None = Field(default=None, ge=1)
    partner_id: int | None = Field(default=None, ge=1)
    payment_type_id: int | None = Field(default=None, ge=1)
    amount: float | None = Field(default=None, gt=0)
    exchange_rate: float | None = Field(default=None, gt=0)
    category_id: int | None = Field(default=None, ge=1)
    description: str | None = Field(default=None, max_length=1000)
    date: int | None = Field(default=None, ge=0)


class PaymentMutationResponse(BaseModel):
    row_affected: int = Field(ge=0)
