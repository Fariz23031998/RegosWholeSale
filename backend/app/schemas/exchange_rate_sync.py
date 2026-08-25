from typing import Any, Literal

from pydantic import BaseModel, Field

SyncRunStatus = Literal["success", "partial", "failed", "skipped"]
RuleResultStatus = Literal["updated", "skipped", "failed"]


class ExchangeRateSyncRule(BaseModel):
    currency_id: int = Field(ge=1)
    currency_code: str = Field(min_length=1, max_length=16)
    formula: str = Field(default="exchange_rate", min_length=1)
    enabled: bool = True


class ExchangeRateSyncSettings(BaseModel):
    enabled: bool = False
    rules: list[ExchangeRateSyncRule] = Field(default_factory=list)
    last_run_at: str | None = None
    last_run_status: SyncRunStatus | None = None
    last_run_results: list[dict[str, Any]] = Field(default_factory=list)
    last_run_trigger: str | None = None
    last_run_message: str | None = None


class ExchangeRateSyncResponse(BaseModel):
    settings: ExchangeRateSyncSettings


class ExchangeRateSyncPatchRequest(BaseModel):
    enabled: bool | None = None
    rules: list[ExchangeRateSyncRule] | None = None


class ExchangeRateSyncRunResponse(BaseModel):
    company_id: int
    trigger: str
    status: SyncRunStatus
    message: str | None = None
    results: list[dict[str, Any]] = Field(default_factory=list)


class ExchangeRateFormulaPreviewRequest(BaseModel):
    formula: str = Field(min_length=1)
    currency_code: str | None = Field(default=None, min_length=1, max_length=16)
    sample_rate: float | None = Field(default=None, gt=0)


class ExchangeRateFormulaPreviewResponse(BaseModel):
    formula: str
    currency_code: str | None = None
    official_rate: float
    calculated_rate: float
