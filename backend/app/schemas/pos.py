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
    auto_open_qty_keypad: bool = False


class UserPosSettings(BaseModel):
    allow_out_of_stock: bool = False
    tendered_quick_amounts: list[float] = Field(
        default_factory=lambda: list(DEFAULT_TENDERED_QUICK_AMOUNTS)
    )
    default_category: DefaultCategorySetting = Field(
        default_factory=lambda: DefaultCategorySetting(mode="all")
    )
    auto_open_qty_keypad: bool = False


class PosSettingsResponse(BaseModel):
    settings: PosSettings


class UserPosSettingsResponse(BaseModel):
    settings: UserPosSettings


class PosSettingsPatchRequest(BaseModel):
    allow_out_of_stock: bool | None = None
    tendered_quick_amounts: list[float] | None = None
    auto_open_qty_keypad: bool | None = None


class UserPosSettingsPatchRequest(BaseModel):
    allow_out_of_stock: bool | None = None
    tendered_quick_amounts: list[float] | None = None
    default_category: DefaultCategorySetting | None = None
    auto_open_qty_keypad: bool | None = None
