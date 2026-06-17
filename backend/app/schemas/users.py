from pydantic import BaseModel, Field

from app.models.user import UserRole


class ScheduleItem(BaseModel):
    day_of_week: int = Field(ge=0, le=6)
    start_time: str
    end_time: str


class ScheduleItemResponse(ScheduleItem):
    id: int


class UserCreateRequest(BaseModel):
    login: str = Field(min_length=2, max_length=64)
    password: str = Field(min_length=8, max_length=128)
    display_name: str = Field(min_length=1, max_length=255)
    role: UserRole = UserRole.employee
    permission_codes: list[str] | None = None
    schedules: list[ScheduleItem] | None = None


class UserUpdateRequest(BaseModel):
    display_name: str | None = None
    password: str | None = Field(default=None, min_length=8, max_length=128)
    role: UserRole | None = None
    is_active: bool | None = None
    permission_codes: list[str] | None = None
    schedules: list[ScheduleItem] | None = None


class UserDetailResponse(BaseModel):
    id: int
    company_id: int
    email: str | None
    login: str | None
    display_name: str
    role: str
    is_active: bool
    permissions: list[str]
    schedules: list[ScheduleItemResponse]


class PermissionResponse(BaseModel):
    id: int
    code: str
    description: str


class PermissionsUpdateRequest(BaseModel):
    permission_codes: list[str]


class SchedulesUpdateRequest(BaseModel):
    schedules: list[ScheduleItem]
