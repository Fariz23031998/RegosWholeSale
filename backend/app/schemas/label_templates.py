from typing import Literal

from pydantic import BaseModel, Field


class LabelPaper(BaseModel):
    width_mm: float = Field(gt=0, le=500)
    height_mm: float = Field(gt=0, le=500)


class LabelTemplateLogo(BaseModel):
    id: str
    name: str = Field(min_length=1, max_length=80)
    src: str
    max_width: int | None = None


class LabelTemplate(BaseModel):
    id: str
    name: str = Field(min_length=1, max_length=120)
    is_default: bool = False
    paper: LabelPaper
    html: str = ""
    css: str = ""
    logos: list[LabelTemplateLogo] = Field(default_factory=list)
    version: int = 1


class LabelPrintService(BaseModel):
    id: str
    name: str = Field(min_length=1, max_length=80)
    printer_name: str = Field(min_length=1, max_length=80)
    is_default: bool = False


class LabelPrintSettings(BaseModel):
    printer_name: str
    token: str
    services: list[LabelPrintService] = Field(default_factory=list)


class LabelTemplatesSettings(BaseModel):
    templates: list[LabelTemplate] = Field(default_factory=list)
    default_template_id: str | None = None
    print: LabelPrintSettings


class LabelTemplatesResponse(BaseModel):
    settings: LabelTemplatesSettings


class LabelTemplatesPatchRequest(BaseModel):
    templates: list[LabelTemplate] | None = None
    default_template_id: str | None = None


class LabelPrintPatchRequest(BaseModel):
    printer_name: str | None = Field(default=None, max_length=80)
    regenerate_token: bool = False
    services: list[LabelPrintService] | None = None


class UserLabelPrintSettings(BaseModel):
    template_id: str | None = None
    service_id: str | None = None
    printer_name: str | None = Field(default=None, max_length=80)
    method: Literal["service", "browser"] = "service"
    prompt_before_print: bool = True
    use_warehouse_quantity: bool = False


class UserLabelPrintSettingsResponse(BaseModel):
    settings: UserLabelPrintSettings


class UserLabelPrintPatchRequest(BaseModel):
    template_id: str | None = None
    service_id: str | None = None
    printer_name: str | None = Field(default=None, max_length=80)
    method: Literal["service", "browser"] = "service"
    prompt_before_print: bool = True
    use_warehouse_quantity: bool = False
