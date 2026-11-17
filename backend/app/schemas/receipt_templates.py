from typing import Literal

from pydantic import BaseModel, Field

ReceiptFormat = Literal["80mm", "a4"]
ReceiptTemplateEngine = Literal["builtin", "html"]
ReceiptAmountInWordsLanguage = Literal["ru", "uz", "en", "tj"]


class ReceiptTemplateHeader(BaseModel):
    company_name: str = ""
    address: str = ""
    phone: str = ""
    tax_id: str = ""


class ReceiptTemplateLogo(BaseModel):
    id: str
    name: str = "Logo"
    src: str = ""
    max_width: int | None = None


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


class ReceiptTemplateLineSort(BaseModel):
    column: Literal[
        "document_order",
        "item_code",
        "item_name",
        "item_group_name",
        "item_brand",
        "item_fullname",
        "item_description",
        "item_articul",
        "item_color_name",
        "item_size_name",
        "item_producer_name",
        "item_country_name",
        "item_unit_name",
        "quantity",
        "price",
        "amount",
    ] = "document_order"
    direction: Literal["asc", "desc"] = "asc"


class ReceiptTemplate(BaseModel):
    id: str
    name: str = Field(min_length=1, max_length=120)
    format: ReceiptFormat
    engine: ReceiptTemplateEngine = "builtin"
    is_default: bool = False
    header: ReceiptTemplateHeader = Field(default_factory=ReceiptTemplateHeader)
    invoice_title: str = ""
    footer_text: str = ""
    amount_in_words_language: ReceiptAmountInWordsLanguage | None = None
    sections: ReceiptTemplateSections = Field(default_factory=ReceiptTemplateSections)
    line_sort: ReceiptTemplateLineSort = Field(default_factory=ReceiptTemplateLineSort)
    logos: list[ReceiptTemplateLogo] = Field(default_factory=list)
    partner_debt_enabled: bool = False
    partner_debt_negative_only: bool = False
    html: str = ""
    css: str = ""


class ReceiptPrintService(BaseModel):
    id: str
    name: str = Field(min_length=1, max_length=80)
    printer_name: str = Field(min_length=1, max_length=80)
    is_default: bool = False


class ReceiptPrintSettings(BaseModel):
    printer_name: str
    services: list[ReceiptPrintService] = Field(default_factory=list)


class ReceiptTemplatesSettings(BaseModel):
    templates: list[ReceiptTemplate] = Field(default_factory=list)
    default_template_id: str | None = None
    print: ReceiptPrintSettings = Field(
        default_factory=lambda: ReceiptPrintSettings(printer_name="Receipts", services=[])
    )


class ReceiptTemplatesResponse(BaseModel):
    settings: ReceiptTemplatesSettings


class ReceiptTemplatesPatchRequest(BaseModel):
    templates: list[ReceiptTemplate] | None = None
    default_template_id: str | None = None
    print: ReceiptPrintSettings | None = None


class ReceiptPrintPatchRequest(BaseModel):
    printer_name: str | None = Field(default=None, max_length=80)
    services: list[ReceiptPrintService] | None = None


class UserDocumentPrintSettings(BaseModel):
    template_id: str | None = None
    service_id: str | None = None
    printer_name: str | None = Field(default=None, max_length=80)
    method: Literal["service", "browser"] = "service"


class UserDocumentPrintSettingsResponse(BaseModel):
    settings: UserDocumentPrintSettings


class UserDocumentPrintPatchRequest(BaseModel):
    template_id: str | None = None
    service_id: str | None = None
    printer_name: str | None = Field(default=None, max_length=80)
    method: Literal["service", "browser"] = "service"
