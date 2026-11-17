from pydantic import BaseModel, Field


class DocumentPrintRequest(BaseModel):
    template_id: str | None = None
    html: str = Field(min_length=1)
    copies: int = Field(default=1, ge=1, le=99)
    station_id: str | None = None
    printer_name: str | None = Field(default=None, max_length=80)


class DocumentPrintResponse(BaseModel):
    job_ids: list[str]
    delivered: int
    pending: int


class DocumentStationPrinter(BaseModel):
    name: str
    kind: str
    enabled: bool


class DocumentStation(BaseModel):
    station_id: str
    station_name: str
    location_id: str | None = None
    online: bool = True
    matches_printer: bool = False
    printers: list[DocumentStationPrinter] = Field(default_factory=list)


class DocumentStationsResponse(BaseModel):
    printer_name: str
    stations: list[DocumentStation]
