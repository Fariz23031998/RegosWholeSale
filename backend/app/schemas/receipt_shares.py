from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.schemas.receipt_templates import ReceiptTemplate


class PublicTemplateShareCreateRequest(BaseModel):
    template: ReceiptTemplate
    context: dict[str, Any]
    document_code: str | None = Field(default=None, max_length=120)


class PublicTemplateShareCreateResponse(BaseModel):
    public_token: str
    url: str
    public_expires_at: datetime
    is_public: bool = True


class PublicTemplateShareResponse(BaseModel):
    public_token: str
    public_expires_at: datetime
    is_public: bool
    template: ReceiptTemplate
    context: dict[str, Any]
    document_code: str | None = None


class PublicTemplateShareErrorResponse(BaseModel):
    detail: str
    code: Literal[
        "PUBLIC_TEMPLATE_NOT_FOUND",
        "PUBLIC_TEMPLATE_EXPIRED",
        "PUBLIC_TEMPLATE_PRIVATE",
    ]
