from pydantic import BaseModel, Field

from app.schemas.label_templates import LabelTemplateLogo


class LabelPrintRequest(BaseModel):
    template_id: str | None = None
    product_ids: list[int] = Field(min_length=1, max_length=200)
    copies: int = Field(default=1, ge=1, le=99)
    station_id: str | None = None
    printer_name: str | None = Field(default=None, max_length=80)
    warehouse_id: int | None = Field(default=None, ge=1)
    price_type_id: int | None = Field(default=None, ge=1)
    use_warehouse_quantity: bool = False
    html_pages: list[str] | None = Field(default=None, max_length=200)


class LabelFieldRow(BaseModel):
    name: str = ""
    price: str = ""
    current_price: str = ""
    old_price: str = ""
    currency: str = ""
    barcode: str = ""
    code: str = ""
    articul: str = ""
    sku: str = ""
    category: str = ""
    unit_name: str = ""
    date: str = ""
    time: str = ""
    barcode_src: str = ""
    qr_src: str = ""
    image_src: str = ""


class LabelRowsResponse(BaseModel):
    html: str
    css: str = ""
    width_mm: float
    height_mm: float
    logos: list[LabelTemplateLogo] = Field(default_factory=list)
    rows: list[LabelFieldRow]
    quantities: list[int] = Field(default_factory=list)


class LabelSampleRowResponse(BaseModel):
    row: LabelFieldRow


class LabelRenderRequest(BaseModel):
    template_id: str | None = None
    product_ids: list[int] = Field(min_length=1, max_length=200)
    copies: int = Field(default=1, ge=1, le=99)
    warehouse_id: int | None = Field(default=None, ge=1)
    price_type_id: int | None = Field(default=None, ge=1)
    use_warehouse_quantity: bool = False


class LabelPreviewRequest(BaseModel):
    html: str = ""
    css: str = ""
    width_mm: float = Field(default=58, gt=0, le=500)
    height_mm: float = Field(default=40, gt=0, le=500)


class LabelPrintResponse(BaseModel):
    job_ids: list[str]
    delivered: int
    pending: int


class LabelRenderResponse(BaseModel):
    html: str
    width_mm: float
    height_mm: float
    count: int


class LabelStationPrinter(BaseModel):
    name: str
    kind: str
    enabled: bool


class LabelStation(BaseModel):
    station_id: str
    station_name: str
    location_id: str | None = None
    online: bool = True
    matches_printer: bool = False
    printers: list[LabelStationPrinter] = Field(default_factory=list)


class LabelStationsResponse(BaseModel):
    printer_name: str
    stations: list[LabelStation]
