from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator


class VerificationData(BaseModel):
    email: EmailStr
    type: Literal["register", "reset_password"] = "register"


class SendVerificationResponse(BaseModel):
    ok: bool = True
    message: str = "Verification code sent"


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    display_name: str = Field(min_length=1, max_length=255)
    company_name: str = Field(min_length=1, max_length=255)
    verification_code: str = Field(min_length=6, max_length=6)

    @field_validator("verification_code")
    @classmethod
    def normalize_verification_code(cls, value: str) -> str:
        digits = "".join(c for c in value if c.isdigit())
        if len(digits) != 6:
            raise ValueError("Verification code must be 6 digits")
        return digits


class ResetPasswordRequest(BaseModel):
    email: EmailStr
    verification_code: str = Field(min_length=6, max_length=6)
    new_password: str = Field(min_length=8, max_length=128)

    @field_validator("verification_code")
    @classmethod
    def normalize_verification_code(cls, value: str) -> str:
        digits = "".join(c for c in value if c.isdigit())
        if len(digits) != 6:
            raise ValueError("Verification code must be 6 digits")
        return digits


class MessageResponse(BaseModel):
    message: str


class LoginEmailRequest(BaseModel):
    email: EmailStr
    password: str


class LoginUsernameRequest(BaseModel):
    login: str
    password: str


class LoginRequest(BaseModel):
    email: EmailStr | None = None
    login: str | None = None
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class CompanySummary(BaseModel):
    id: int
    name: str
    slug: str
    timezone: str


class UserResponse(BaseModel):
    id: int
    company_id: int
    email: str | None
    login: str | None
    display_name: str
    role: str
    is_active: bool
    permissions: list[str]
    company: CompanySummary | None = None


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse
