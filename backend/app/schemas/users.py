from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.models.user import UserRole


class ScheduleItem(BaseModel):
    day_of_week: int = Field(ge=0, le=6)
    start_time: str
    end_time: str


class ScheduleItemResponse(ScheduleItem):
    id: int


class PermissionRule(BaseModel):
    code: str
    effect: Literal["allow", "deny"]


def _normalize_login(value: str) -> str:
    login = value.strip()
    if "@" in login:
        raise ValueError("Login cannot contain @")
    return login


class UserCreateRequest(BaseModel):
    login: str = Field(min_length=2, max_length=64)
    password: str = Field(min_length=8, max_length=128)
    display_name: str = Field(min_length=1, max_length=255)
    role: UserRole = UserRole.employee
    permission_rules: list[PermissionRule] | None = None
    schedules: list[ScheduleItem] | None = None

    @field_validator("login")
    @classmethod
    def validate_login(cls, value: str) -> str:
        return _normalize_login(value)


class UserUpdateRequest(BaseModel):
    display_name: str | None = None
    login: str | None = Field(default=None, min_length=2, max_length=64)
    password: str | None = Field(default=None, min_length=8, max_length=128)
    role: UserRole | None = None
    is_active: bool | None = None
    permission_rules: list[PermissionRule] | None = None
    schedules: list[ScheduleItem] | None = None

    @field_validator("login")
    @classmethod
    def validate_login(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _normalize_login(value)


class UserDetailResponse(BaseModel):
    id: int
    company_id: int
    email: str | None
    login: str | None
    display_name: str
    role: str
    is_active: bool
    permissions: list[str]
    permission_rules: list[PermissionRule]
    schedules: list[ScheduleItemResponse]


class PermissionResponse(BaseModel):
    id: int
    code: str
    description: str


class PermissionsUpdateRequest(BaseModel):
    permission_rules: list[PermissionRule]


class SchedulesUpdateRequest(BaseModel):
    schedules: list[ScheduleItem]
