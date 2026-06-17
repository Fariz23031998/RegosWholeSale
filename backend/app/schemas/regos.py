from pydantic import BaseModel, Field


class RegosTokenUpsert(BaseModel):
    token: str = Field(..., min_length=32, max_length=32)
    is_replicable: bool = False


class RegosTokenConfig(BaseModel):
    configured: bool = False
    token: str = ""
    is_replicable: bool = False


class RegosTokenStatus(BaseModel):
    configured: bool = False
    is_replicable: bool = False


class RegosTokenMessage(BaseModel):
    message: str
    is_replicable: bool | None = None
