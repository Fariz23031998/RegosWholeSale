from pydantic import BaseModel, Field


class PriceChangeLine(BaseModel):
    item_id: int = Field(ge=1)
    base_value: float = Field(ge=0)
    new_value: float = Field(ge=0)


class SetProductPricesRequest(BaseModel):
    price_type_id: int = Field(ge=1)
    lines: list[PriceChangeLine] = Field(min_length=1)


class SetProductPricesResponse(BaseModel):
    document_id: int


class PriceDocument(BaseModel):
    id: int
    code: str = ""
    date: int = 0
    price_type_id: int | None = None
    price_type_name: str = ""
    description: str = ""
    performed: bool = False


class PriceDocumentsResponse(BaseModel):
    documents: list[PriceDocument]
    next_offset: int = 0
    total: int = 0


class PriceDocumentOperation(BaseModel):
    id: int
    item_id: int
    item_code: str = ""
    item_name: str = ""
    base_value: float = 0
    new_value: float = 0


class PriceDocumentOperationsResponse(BaseModel):
    operations: list[PriceDocumentOperation]
