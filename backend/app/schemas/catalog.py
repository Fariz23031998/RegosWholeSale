from pydantic import BaseModel, Field

from app.schemas.settings import RegosCurrencyOption


class CatalogProduct(BaseModel):
    id: str
    regos_item_id: int = Field(ge=1)
    group_id: int | None = Field(default=None, ge=1)
    name: str
    price: float = 0
    category: str
    stock: float = 0
    image: str = ""
    sku: str
    articul: str = ""
    barcode: str = ""
    code: str = ""
    unit_name: str = ""
    unit_type: int | None = None


class CatalogProductsResponse(BaseModel):
    products: list[CatalogProduct]
    next_offset: int = Field(ge=0)
    total: int = Field(ge=0)


class CatalogGroup(BaseModel):
    id: int = Field(ge=1)
    parent_id: int | None = Field(default=None, ge=1)
    name: str
    path: str
    child_count: int = Field(ge=0)


class CatalogGroupsResponse(BaseModel):
    groups: list[CatalogGroup]


class PaymentType(BaseModel):
    id: int = Field(ge=1)
    name: str
    is_cash: bool
    allows_debt: bool = False
    image_url: str = ""
    account_id: int | None = Field(default=None, ge=1)
    currency: RegosCurrencyOption | None = None


class PaymentTypesResponse(BaseModel):
    payment_types: list[PaymentType]
