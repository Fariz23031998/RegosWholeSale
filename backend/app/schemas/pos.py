from pydantic import BaseModel, Field


DEFAULT_TENDERED_QUICK_AMOUNTS = [20.0, 50.0, 100.0]


class DefaultCategorySetting(BaseModel):
    mode: str = "all"
    group_id: int | None = Field(default=None, ge=1)


class PosSettings(BaseModel):
    allow_out_of_stock: bool = False
    tendered_quick_amounts: list[float] = Field(
        default_factory=lambda: list(DEFAULT_TENDERED_QUICK_AMOUNTS)
    )


class UserPosSettings(BaseModel):
    default_category: DefaultCategorySetting = Field(
        default_factory=lambda: DefaultCategorySetting(mode="all")
    )


class PosSettingsResponse(BaseModel):
    settings: PosSettings


class UserPosSettingsResponse(BaseModel):
    settings: UserPosSettings


class PosSettingsPatchRequest(BaseModel):
    allow_out_of_stock: bool | None = None
    tendered_quick_amounts: list[float] | None = None


class UserPosSettingsPatchRequest(BaseModel):
    default_category: DefaultCategorySetting | None = None
