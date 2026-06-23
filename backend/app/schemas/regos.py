from pydantic import BaseModel, Field


class RegosTokenUpsert(BaseModel):
    token: str = Field(..., min_length=32, max_length=32)
    is_replicable: bool = False


class RegosTokenConfig(BaseModel):
    configured: bool = False
    token: str = ""
    is_replicable: bool = False
    webhook_url: str | None = None


class RegosTokenStatus(BaseModel):
    configured: bool = False
    is_replicable: bool = False


class RegosTokenMessage(BaseModel):
    message: str
    is_replicable: bool | None = None


class RegosCustomField(BaseModel):
    id: int = Field(ge=1)
    key: str
    name: str
    entity_type: str
    data_type: str


class RegosDocPaymentSaleIdFieldResponse(BaseModel):
    configured: bool
    field: RegosCustomField | None = None
    created: bool = False
