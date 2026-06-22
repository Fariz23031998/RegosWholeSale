from datetime import datetime

from pydantic import BaseModel, Field


class CheckoutItemRequest(BaseModel):
    regos_item_id: int = Field(ge=1)
    qty: float = Field(gt=0)
    price: float = Field(ge=0)


class CheckoutRequest(BaseModel):
    items: list[CheckoutItemRequest] = Field(min_length=1)
    discount: float = Field(default=0, ge=0)
    payment_type_id: int = Field(ge=1)
    total: float = Field(ge=0)
    amount_paid: float | None = Field(default=None, ge=0)
    tendered: float | None = Field(default=None, ge=0)
    change: float | None = Field(default=None, ge=0)
    description: str | None = None
    warehouse_id: int | None = Field(default=None, ge=1)
    price_type_id: int | None = Field(default=None, ge=1)
    partner_id: int | None = Field(default=None, ge=1)


class CheckoutLineResponse(BaseModel):
    regos_item_id: int
    qty: float
    price: float
    price2: float


class CheckoutPaymentResponse(BaseModel):
    payment_type_id: int
    payment_doc_id: int | None = None
    amount: float
    amount_paid: float
    balance_due: float
    is_fully_paid: bool
    tendered: float | None = None
    change: float | None = None


class CheckoutResponse(BaseModel):
    wholesale_doc_id: int
    wholesale_code: str
    payment_doc_id: int | None = None
    performed_at: datetime
    lines: list[CheckoutLineResponse]
    payment: CheckoutPaymentResponse
    subtotal: float
    discount: float
    total: float
    amount_paid: float
    balance_due: float
    is_fully_paid: bool


class WholesaleDocument(BaseModel):
    id: int
    code: str
    date: int
    partner_id: int | None = None
    partner_name: str | None = None
    stock_id: int | None = None
    stock_name: str | None = None
    amount: float | None = None
    performed: bool = False


class WholesaleDocumentsResponse(BaseModel):
    documents: list[WholesaleDocument]
    next_offset: int = 0
    total: int = 0


class WholesaleOperationLine(BaseModel):
    id: int
    document_id: int
    item_id: int
    item_name: str | None = None
    quantity: float
    price: float
    price2: float | None = None
    amount: float | None = None


class WholesaleOperationsResponse(BaseModel):
    operations: list[WholesaleOperationLine]
