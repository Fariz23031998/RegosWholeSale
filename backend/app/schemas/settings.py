from typing import Any, Literal

from pydantic import BaseModel, Field


VatCalculationType = Literal["No", "Exclude", "Include"]

class SettingsResponse(BaseModel):
    settings: dict[str, Any]


class SettingsPatchRequest(BaseModel):
    settings: dict[str, Any]


class RegosDefaultOption(BaseModel):
    id: int = Field(ge=1)
    name: str


class RegosCurrencyOption(BaseModel):
    id: int = Field(ge=1)
    name: str
    code_chr: str | None = None
    exchange_rate: float | None = Field(default=None, gt=0)


class RegosPriceTypeOption(RegosDefaultOption):
    currency: RegosCurrencyOption | None = None


class RegosDefaults(BaseModel):
    warehouse: RegosDefaultOption | None = None
    price_type: RegosDefaultOption | None = None
    partner: RegosDefaultOption | None = None
    currency: RegosCurrencyOption | None = None
    firm: RegosDefaultOption | None = None
    payment_category: RegosDefaultOption | None = None
    refund_payment_category: RegosDefaultOption | None = None
    attached_user: RegosDefaultOption | None = None
    vat_calculation_type: VatCalculationType = "Exclude"
    zero_quantity: bool = False
    zero_price: bool = False


class RegosDefaultsResponse(BaseModel):
    defaults: RegosDefaults


class RegosDefaultsPatchRequest(BaseModel):
    warehouse_id: int | None = Field(default=None, ge=1)
    price_type_id: int | None = Field(default=None, ge=1)
    partner_id: int | None = Field(default=None, ge=1)
    payment_category_id: int | None = Field(default=None, ge=1)
    refund_payment_category_id: int | None = Field(default=None, ge=1)
    attached_user_id: int | None = Field(default=None, ge=1)
    vat_calculation_type: VatCalculationType | None = None
    zero_quantity: bool | None = None
    zero_price: bool | None = None


class RegosReferenceOptionsResponse(BaseModel):
    warehouses: list[RegosDefaultOption] = Field(default_factory=list)
    price_types: list[RegosPriceTypeOption] = Field(default_factory=list)
    partners: list[RegosDefaultOption] = Field(default_factory=list)
    payment_categories: list[RegosDefaultOption] = Field(default_factory=list)
    refund_payment_categories: list[RegosDefaultOption] = Field(default_factory=list)
    attached_users: list[RegosDefaultOption] = Field(default_factory=list)
    firms: list[RegosDefaultOption] = Field(default_factory=list)
