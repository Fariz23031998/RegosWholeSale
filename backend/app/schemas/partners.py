from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.settings import RegosCurrencyOption, RegosDefaultOption

class PartnerGroup(BaseModel):
    id: int = Field(ge=0)
    name: str


class Partner(BaseModel):
    id: int = Field(ge=1)
    name: str
    fullname: str | None = None
    legal_status: Literal["Legal", "Natural"]
    group_id: int = Field(ge=0)
    group_name: str | None = None
    boss_name: str | None = None
    address: str | None = None
    phones: str | None = None
    email: str | None = None
    description: str | None = None
    inn: str | None = None
    bank_name: str | None = None
    mfo: str | None = None
    rs: str | None = None
    oked: str | None = None
    vat_index: str | None = None
    deleted_mark: bool = False


class PartnersListResponse(BaseModel):
    partners: list[Partner]
    next_offset: int = Field(ge=0)
    total: int = Field(ge=0)


class PartnerGroupsResponse(BaseModel):
    groups: list[PartnerGroup]


class FirmsListResponse(BaseModel):
    firms: list[RegosDefaultOption] = Field(default_factory=list)


class PartnerCreateRequest(BaseModel):
    group_id: int = Field(ge=0)
    legal_status: Literal["Legal", "Natural"]
    name: str = Field(min_length=1, max_length=255)
    fullname: str | None = Field(default=None, max_length=255)
    boss_name: str | None = Field(default=None, max_length=255)
    address: str | None = Field(default=None, max_length=500)
    phones: str | None = Field(default=None, max_length=255)
    email: str | None = Field(default=None, max_length=255)
    description: str | None = Field(default=None, max_length=1000)
    inn: str | None = Field(default=None, max_length=64)
    bank_name: str | None = Field(default=None, max_length=255)
    mfo: str | None = Field(default=None, max_length=16)
    rs: str | None = Field(default=None, max_length=64)
    oked: str | None = Field(default=None, max_length=64)
    vat_index: str | None = Field(default=None, max_length=64)


class PartnerUpdateRequest(BaseModel):
    group_id: int | None = Field(default=None, ge=0)
    legal_status: Literal["Legal", "Natural"] | None = None
    name: str | None = Field(default=None, min_length=1, max_length=255)
    fullname: str | None = Field(default=None, max_length=255)
    boss_name: str | None = Field(default=None, max_length=255)
    address: str | None = Field(default=None, max_length=500)
    phones: str | None = Field(default=None, max_length=255)
    email: str | None = Field(default=None, max_length=255)
    description: str | None = Field(default=None, max_length=1000)
    inn: str | None = Field(default=None, max_length=64)
    bank_name: str | None = Field(default=None, max_length=255)
    mfo: str | None = Field(default=None, max_length=16)
    rs: str | None = Field(default=None, max_length=64)
    oked: str | None = Field(default=None, max_length=64)
    vat_index: str | None = Field(default=None, max_length=64)


class PartnerCreateResponse(BaseModel):
    id: int = Field(ge=1)


class PartnerMutationResponse(BaseModel):
    row_affected: int = Field(ge=0)


class PartnerBalanceDocumentType(BaseModel):
    id: int = Field(ge=1)
    name: str


class PartnerBalanceRow(BaseModel):
    id: int = Field(ge=1)
    date: int = Field(ge=0)
    document_code: str | None = None
    document_id: int | None = Field(default=None, ge=1)
    document_type: PartnerBalanceDocumentType | None = None
    currency: RegosCurrencyOption | None = None
    firm: RegosDefaultOption | None = None
    exchange_rate: float | None = Field(default=None, gt=0)
    currency_amount: float | None = None
    start_amount: float = 0
    debit: float = 0
    credit: float = 0
    end_amount: float = 0


class PartnerBalanceResponse(BaseModel):
    rows: list[PartnerBalanceRow]
