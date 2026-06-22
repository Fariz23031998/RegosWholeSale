from typing import Literal

from pydantic import BaseModel, Field


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
