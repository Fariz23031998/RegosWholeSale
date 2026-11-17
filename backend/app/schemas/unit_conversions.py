from pydantic import BaseModel, Field


class UnitConversion(BaseModel):
    id: int = Field(ge=1)
    main_unit_id: int = Field(ge=1)
    secondary_unit_id: int = Field(ge=1)
    conversion_factor: float = Field(gt=0)
    price_type_id: int | None = Field(default=None, ge=1)
    main_unit_name: str | None = None
    secondary_unit_name: str | None = None
    secondary_unit_type: int | None = None


class UnitConversionUpsertRequest(BaseModel):
    main_unit_id: int = Field(ge=1)
    secondary_unit_id: int = Field(ge=1)
    conversion_factor: float = Field(gt=0)
    price_type_id: int | None = Field(default=None, ge=1)


class UnitConversionResponse(BaseModel):
    conversion: UnitConversion


class UnitConversionsListResponse(BaseModel):
    conversions: list[UnitConversion]
