from typing import Any, Literal

from pydantic import BaseModel, Field

from app.schemas.settings import RegosCurrencyOption

StockDocKind = Literal["purchase", "movement", "inventory", "wholesale", "inout"]


class StockDocument(BaseModel):
    id: int
    code: str
    date: int = 0
    open_date: int | None = None
    close_date: int | None = None
    partner_id: int | None = None
    partner_name: str | None = None
    stock_id: int | None = None
    stock_name: str | None = None
    stock_sender_id: int | None = None
    stock_sender_name: str | None = None
    stock_receiver_id: int | None = None
    stock_receiver_name: str | None = None
    price_type_id: int | None = None
    attached_user_id: int | None = None
    attached_user_name: str | None = None
    amount: float | None = None
    performed: bool = False
    closed: bool = False
    blocked: bool = False
    currency: RegosCurrencyOption | None = None
    description: str | None = None
    compare_type: str | None = None
    vat_calculation_type: str | None = None
    inout_type: str | None = None


class StockDocumentsResponse(BaseModel):
    documents: list[StockDocument]
    next_offset: int = 0
    total: int = 0


class StockOperationLine(BaseModel):
    id: int
    document_id: int
    item_id: int
    item_code: str | None = None
    item_name: str | None = None
    item_unit_name: str | None = None
    quantity: float = 0
    cost: float | None = None
    price: float | None = None
    price2: float | None = None
    amount: float | None = None
    description: str | None = None
    vat_value: float | None = None


class StockOperationsResponse(BaseModel):
    operations: list[StockOperationLine]


class StockDocumentCreateRequest(BaseModel):
    date: int | None = None
    partner_id: int | None = Field(default=None, ge=1)
    stock_id: int | None = Field(default=None, ge=1)
    stock_sender_id: int | None = Field(default=None, ge=1)
    stock_receiver_id: int | None = Field(default=None, ge=1)
    currency_id: int | None = Field(default=None, ge=1)
    price_type_id: int | None = Field(default=None, ge=1)
    attached_user_id: int | None = Field(default=None, ge=1)
    vat_calculation_type: str | None = None
    compare_type: str | None = None
    description: str | None = None
    inout_type: str | None = None


class StockDocumentUpdateRequest(BaseModel):
    date: int | None = None
    partner_id: int | None = Field(default=None, ge=1)
    stock_id: int | None = Field(default=None, ge=1)
    stock_sender_id: int | None = Field(default=None, ge=1)
    stock_receiver_id: int | None = Field(default=None, ge=1)
    currency_id: int | None = Field(default=None, ge=1)
    price_type_id: int | None = Field(default=None, ge=1)
    attached_user_id: int | None = Field(default=None, ge=1)
    vat_calculation_type: str | None = None
    compare_type: str | None = None
    description: str | None = None
    inout_type: str | None = None


class StockDocumentCreateResponse(BaseModel):
    id: int
    code: str | None = None


class StockMutationResponse(BaseModel):
    ok: bool = True
    row_affected: int | None = None


class StockOperationAddItem(BaseModel):
    document_id: int = Field(ge=1)
    item_id: int = Field(ge=1)
    quantity: float | None = Field(default=None, gt=0)
    actual_quantity: float | None = None
    cost: float | None = Field(default=None, ge=0)
    price: float | None = Field(default=None, ge=0)
    price2: float | None = Field(default=None, ge=0)
    vat_value: float | None = None
    description: str | None = None
    datetime: int | None = None
    update_actual_quantity: bool | None = None


class StockOperationsAddRequest(BaseModel):
    operations: list[StockOperationAddItem] = Field(min_length=1)


class StockOperationEditItem(BaseModel):
    id: int = Field(ge=1)
    quantity: float | None = Field(default=None, gt=0)
    actual_quantity: float | None = None
    cost: float | None = Field(default=None, ge=0)
    price: float | None = Field(default=None, ge=0)
    description: str | None = None
    update_actual_quantity: bool | None = None


class StockOperationsEditRequest(BaseModel):
    operations: list[StockOperationEditItem] = Field(min_length=1)


class StockOperationsDeleteRequest(BaseModel):
    ids: list[int] = Field(min_length=1)


class StockItemSearchHit(BaseModel):
    id: int
    name: str
    barcode: str | None = None
    code: str | None = None
    articul: str | None = None
    unit: str | None = None
    unit_piece: bool = False
    vat_value: float | None = None
    last_purchase_cost: float | None = None
    price: float | None = None
    price2: float | None = None
    quantity_common: float | None = None


class StockItemSearchResponse(BaseModel):
    items: list[StockItemSearchHit]


class StockQuantityRow(BaseModel):
    stock_id: int
    stock_name: str | None = None
    quantity: float = 0


class StockPriceRow(BaseModel):
    price_type_id: int
    price_type_name: str | None = None
    price: float = 0
    currency_code: str | None = None


class StockItemOperationRow(BaseModel):
    id: int | None = None
    datetime: int | None = None
    document_code: str | None = None
    document_type: str | None = None
    stock_id: int | None = None
    stock_name: str | None = None
    quantity: float | None = None
    price: float | None = None


class StockItemInfoResponse(BaseModel):
    item: StockItemSearchHit
    quantities: list[StockQuantityRow] = Field(default_factory=list)
    prices: list[StockPriceRow] = Field(default_factory=list)
    operations: list[StockItemOperationRow] = Field(default_factory=list)
    similar: list[StockItemSearchHit] = Field(default_factory=list)
    raw: dict[str, Any] | None = None
