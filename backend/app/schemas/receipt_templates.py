from typing import Literal

from pydantic import BaseModel, Field

ReceiptFormat = Literal["80mm", "a4"]


class ReceiptTemplateHeader(BaseModel):
    company_name: str = ""
    address: str = ""
    phone: str = ""
    tax_id: str = ""


class ReceiptTemplateSections(BaseModel):
    header: bool = True
    meta: bool = True
    partner: bool = False
    items: bool = True
    subtotal: bool = True
    discount: bool = True
    total: bool = True
    payments: bool = True
    tendered_change: bool = True
    balance_due: bool = True
    closed_without_payment: bool = True
    footer: bool = True


class ReceiptTemplate(BaseModel):
    id: str
    name: str = Field(min_length=1, max_length=120)
    format: ReceiptFormat
    is_default: bool = False
    header: ReceiptTemplateHeader = Field(default_factory=ReceiptTemplateHeader)
    invoice_title: str = ""
    footer_text: str = ""
    sections: ReceiptTemplateSections = Field(default_factory=ReceiptTemplateSections)


class ReceiptTemplatesSettings(BaseModel):
    templates: list[ReceiptTemplate] = Field(default_factory=list)
    default_template_id: str | None = None


class ReceiptTemplatesResponse(BaseModel):
    settings: ReceiptTemplatesSettings


class ReceiptTemplatesPatchRequest(BaseModel):
    templates: list[ReceiptTemplate] | None = None
    default_template_id: str | None = None
