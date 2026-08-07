from typing import Literal

from pydantic import BaseModel, Field


class RegosUnit(BaseModel):
    id: int = Field(ge=1)
    name: str
    type: Literal["pcs", "non_pcs"] | None = None


class RegosUnitsResponse(BaseModel):
    units: list[RegosUnit]


class RegosTaxVat(BaseModel):
    id: int = Field(ge=1)
    name: str
    value: float | None = None
    enabled: bool = True


class RegosTaxVatsResponse(BaseModel):
    tax_vats: list[RegosTaxVat]


class RegosItemDetail(BaseModel):
    id: int = Field(ge=1)
    name: str
    fullname: str | None = None
    description: str | None = None
    articul: str | None = None
    code: str | None = None
    barcode: str | None = None
    barcodes: list[str] = Field(default_factory=list)
    icps: str | None = None
    package_code: str | None = None
    is_labeled: bool = False
    group_id: int = Field(ge=0)
    group_name: str | None = None
    unit_id: int = Field(ge=0)
    unit_name: str | None = None
    vat_id: int = Field(ge=0)
    vat_name: str | None = None
    vat_value: float | None = None
    type: Literal["Item", "Service"] = "Item"


class ItemCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    group_id: int = Field(ge=0)
    unit_id: int = Field(ge=1)
    vat_id: int = Field(ge=1)
    type: Literal["Item", "Service"] = "Item"
    fullname: str | None = Field(default=None, max_length=255)
    description: str | None = Field(default=None, max_length=1000)
    articul: str | None = Field(default=None, max_length=255)
    code: int | None = Field(default=None, ge=0)
    barcode: str | None = Field(default=None, max_length=64)
    barcodes: list[str] | None = None
    icps: str | None = Field(default=None, max_length=64)
    package_code: str | None = Field(default=None, max_length=64)
    is_labeled: bool | None = None


class ItemUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=150)
    group_id: int | None = Field(default=None, ge=0)
    unit_id: int | None = Field(default=None, ge=1)
    vat_id: int | None = Field(default=None, ge=1)
    type: Literal["Item", "Service"] | None = None
    fullname: str | None = Field(default=None, max_length=255)
    description: str | None = Field(default=None, max_length=1000)
    articul: str | None = Field(default=None, max_length=255)
    code: int | None = Field(default=None, ge=0)
    barcode: str | None = Field(default=None, max_length=64)
    barcodes: list[str] | None = None
    icps: str | None = Field(default=None, max_length=64)
    package_code: str | None = Field(default=None, max_length=64)
    is_labeled: bool | None = None


class ItemCreateResponse(BaseModel):
    id: int = Field(ge=1)


class ItemMutationResponse(BaseModel):
    row_affected: int = Field(ge=0)
