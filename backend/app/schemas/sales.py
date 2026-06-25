from datetime import datetime

from pydantic import BaseModel, Field, model_validator

from app.schemas.settings import RegosCurrencyOption


class CheckoutItemRequest(BaseModel):
    regos_item_id: int = Field(ge=1)
    qty: float = Field(gt=0)
    price: float = Field(ge=0)


class CheckoutPaymentLineRequest(BaseModel):
    payment_type_id: int = Field(ge=1)
    amount_paid: float = Field(ge=0)
    tendered: float | None = Field(default=None, ge=0)
    change: float | None = Field(default=None, ge=0)


class PostponeRequest(BaseModel):
    items: list[CheckoutItemRequest] = Field(min_length=1)
    discount: float = Field(default=0, ge=0)
    total: float = Field(ge=0)
    description: str | None = None
    wholesale_doc_id: int | None = Field(default=None, ge=1)
    warehouse_id: int | None = Field(default=None, ge=1)
    price_type_id: int | None = Field(default=None, ge=1)
    partner_id: int | None = Field(default=None, ge=1)


class CheckoutRequest(BaseModel):
    items: list[CheckoutItemRequest] = Field(min_length=1)
    discount: float = Field(default=0, ge=0)
    payment_type_id: int | None = Field(default=None, ge=1)
    payments: list[CheckoutPaymentLineRequest] | None = None
    total: float = Field(ge=0)
    amount_paid: float | None = Field(default=None, ge=0)
    tendered: float | None = Field(default=None, ge=0)
    change: float | None = Field(default=None, ge=0)
    description: str | None = None
    wholesale_doc_id: int | None = Field(default=None, ge=1)
    warehouse_id: int | None = Field(default=None, ge=1)
    price_type_id: int | None = Field(default=None, ge=1)
    partner_id: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def validate_payment_source(self) -> "CheckoutRequest":
        if self.payments is not None:
            if len(self.payments) < 1:
                raise ValueError("payments must contain at least one entry")
            return self
        if self.payment_type_id is None:
            raise ValueError("payment_type_id is required when payments is not provided")
        return self


class CheckoutLineResponse(BaseModel):
    regos_item_id: int
    qty: float
    price: float
    price2: float


class PostponeResponse(BaseModel):
    wholesale_doc_id: int
    wholesale_code: str
    lines: list[CheckoutLineResponse]
    subtotal: float
    discount: float
    total: float


class CheckoutPaymentResponse(BaseModel):
    payment_type_id: int
    payment_doc_id: int | None = None
    amount: float
    amount_paid: float
    balance_due: float
    is_fully_paid: bool
    tendered: float | None = None
    change: float | None = None
    sale_currency: RegosCurrencyOption | None = None
    payment_currency: RegosCurrencyOption | None = None
    payment_amount: float | None = None


class CheckoutResponse(BaseModel):
    wholesale_doc_id: int
    wholesale_code: str
    payment_doc_id: int | None = None
    performed_at: datetime
    lines: list[CheckoutLineResponse]
    payment: CheckoutPaymentResponse
    payments: list[CheckoutPaymentResponse] = Field(default_factory=list)
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
    partner_phone: str | None = None
    stock_id: int | None = None
    stock_name: str | None = None
    attached_user_id: int | None = None
    attached_user_name: str | None = None
    amount: float | None = None
    performed: bool = False
    currency: RegosCurrencyOption | None = None


class WholesalePaymentLine(BaseModel):
    id: int
    code: str
    date: int
    amount: float | None = None
    category_id: int | None = None
    category_name: str | None = None
    payment_type_name: str | None = None
    partner_id: int | None = None
    partner_name: str | None = None
    attached_user_id: int | None = None
    attached_user_name: str | None = None
    exchange_rate: float | None = None
    currency: RegosCurrencyOption | None = None


class WholesalePaymentsResponse(BaseModel):
    payments: list[WholesalePaymentLine]


class WholesaleDocumentsResponse(BaseModel):
    documents: list[WholesaleDocument]
    next_offset: int = 0
    total: int = 0


class ReceiptOperationItemNameRef(BaseModel):
    name: str | None = None


class ReceiptOperationItemVat(BaseModel):
    name: str | None = None
    value: float | None = None


class ReceiptOperationItem(BaseModel):
    fullname: str | None = None
    description: str | None = None
    articul: str | None = None
    color: ReceiptOperationItemNameRef = Field(default_factory=ReceiptOperationItemNameRef)
    size: ReceiptOperationItemNameRef = Field(default_factory=ReceiptOperationItemNameRef)
    producer: ReceiptOperationItemNameRef = Field(default_factory=ReceiptOperationItemNameRef)
    country: ReceiptOperationItemNameRef = Field(default_factory=ReceiptOperationItemNameRef)
    icps: str | None = None
    package_code: str | None = None
    department: ReceiptOperationItemNameRef = Field(default_factory=ReceiptOperationItemNameRef)
    vat: ReceiptOperationItemVat = Field(default_factory=ReceiptOperationItemVat)
    base_barcode: str | None = None


class WholesaleOperationLine(BaseModel):
    id: int
    document_id: int
    item_id: int
    item_code: str | None = None
    item_name: str | None = None
    item_group_id: int | None = None
    item_group_name: str | None = None
    item_unit_name: str | None = None
    item_brand: str | None = None
    quantity: float
    price: float
    price2: float | None = None
    amount: float | None = None
    last_purchase_cost: float | None = None
    item: ReceiptOperationItem = Field(default_factory=ReceiptOperationItem)


class WholesaleOperationsResponse(BaseModel):
    operations: list[WholesaleOperationLine]


class WholesaleReturnDocument(WholesaleDocument):
    description: str | None = None
    wholesale_doc_id: int | None = None
    reason: str | None = None


class WholesaleReturnDocumentsResponse(BaseModel):
    documents: list[WholesaleReturnDocument]
    next_offset: int = 0
    total: int = 0


class WholesaleReturnSummaryItem(BaseModel):
    item_id: int
    returned_qty: float


class WholesaleReturnSummaryResponse(BaseModel):
    wholesale_doc_id: int
    items: list[WholesaleReturnSummaryItem]


class WholesaleReturnItemRequest(BaseModel):
    regos_item_id: int = Field(ge=1)
    qty: float = Field(gt=0)
    price: float | None = Field(default=None, ge=0)


class WholesaleReturnRequest(BaseModel):
    wholesale_doc_id: int | None = Field(default=None, ge=1)
    items: list[WholesaleReturnItemRequest] = Field(min_length=1)
    total: float = Field(ge=0)
    reason: str | None = None
    payment_type_id: int | None = Field(default=None, ge=1)
    payments: list[CheckoutPaymentLineRequest] | None = None
    amount_paid: float | None = Field(default=None, ge=0)
    tendered: float | None = Field(default=None, ge=0)
    change: float | None = Field(default=None, ge=0)
    warehouse_id: int | None = Field(default=None, ge=1)
    price_type_id: int | None = Field(default=None, ge=1)
    partner_id: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def validate_return_mode(self) -> "WholesaleReturnRequest":
        if self.wholesale_doc_id is None:
            for item in self.items:
                if item.price is None:
                    raise ValueError("price is required on each item for manual returns")
        if self.payments is not None:
            if len(self.payments) < 1:
                raise ValueError("payments must contain at least one entry")
            return self
        if self.payment_type_id is None:
            raise ValueError("payment_type_id is required when payments is not provided")
        return self


class WholesaleReturnLineResponse(BaseModel):
    regos_item_id: int
    qty: float
    price: float
    price2: float


class WholesaleReturnResponse(BaseModel):
    wholesale_return_doc_id: int
    wholesale_return_code: str
    wholesale_doc_id: int | None = None
    performed_at: datetime
    lines: list[WholesaleReturnLineResponse]
    total: float
    reason: str | None = None
    payment_doc_id: int | None = None
    payment: CheckoutPaymentResponse
    payments: list[CheckoutPaymentResponse] = Field(default_factory=list)
    amount_paid: float
    balance_due: float
    is_fully_paid: bool
