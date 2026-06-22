from fastapi import APIRouter, BackgroundTasks, Depends

from sqlalchemy.ext.asyncio import AsyncSession



from app.api.deps import CurrentUser, get_current_user

from app.core.exceptions import bad_request

from app.database import get_db

from app.schemas.auth import (

    AuthResponse,

    CompanySummary,

    LoginRequest,

    MessageResponse,

    RegisterRequest,

    ResetPasswordRequest,

    SendVerificationResponse,

    UserResponse,

    VerificationData,

)

from app.services import auth as auth_service

from app.services.permissions import effective_permission_codes, get_user_with_permissions

from app.services.verification import (

    add_verification_code,

    email_exists,

    send_verification_email,

)



router = APIRouter(prefix="/auth", tags=["auth"])





@router.post("/send-verification-code", response_model=SendVerificationResponse)

async def send_verification_code_route(

    body: VerificationData,

    background_tasks: BackgroundTasks,

    session: AsyncSession = Depends(get_db),

) -> SendVerificationResponse:

    email = body.email.lower()

    exists = await email_exists(session, email)



    if exists and body.type == "register":

        raise bad_request("Email already exists", "EMAIL_EXISTS")

    if not exists and body.type == "reset_password":

        raise bad_request("No account found for this email address", "EMAIL_NOT_FOUND")



    code = await add_verification_code(session, email)

    background_tasks.add_task(send_verification_email, email, code)

    return SendVerificationResponse()





@router.post("/register", response_model=AuthResponse)

async def register(body: RegisterRequest, session: AsyncSession = Depends(get_db)) -> AuthResponse:

    user, company, token = await auth_service.register_owner(

        session,

        email=body.email,

        password=body.password,

        display_name=body.display_name,

        company_name=body.company_name,

        verification_code=body.verification_code,

    )

    return AuthResponse(

        access_token=token,

        user=_user_response(user, company),

    )





@router.post("/login", response_model=AuthResponse)

async def login(body: LoginRequest, session: AsyncSession = Depends(get_db)) -> AuthResponse:

    if body.email:

        user, token = await auth_service.login_with_email(

            session, email=body.email, password=body.password

        )

    elif body.company_slug and body.login:

        user, token = await auth_service.login_with_company_login(

            session,

            company_slug=body.company_slug,

            login=body.login,

            password=body.password,

        )

    else:

        raise bad_request(

            "Provide email+password or company_slug+login+password",

            "INVALID_LOGIN_REQUEST",

        )

    return AuthResponse(

        access_token=token,

        user=_user_response(user, user.company),

    )





@router.post("/reset-password", response_model=MessageResponse)

async def reset_password(

    body: ResetPasswordRequest, session: AsyncSession = Depends(get_db)

) -> MessageResponse:

    await auth_service.reset_password(

        session,

        email=body.email,

        verification_code=body.verification_code,

        new_password=body.new_password,

    )

    return MessageResponse(message="Password updated successfully")





@router.get("/me", response_model=UserResponse)

async def me(

    current: CurrentUser = Depends(get_current_user),

    session: AsyncSession = Depends(get_db),

) -> UserResponse:

    user = await get_user_with_permissions(session, current.id)

    if not user:

        from app.core.exceptions import not_found



        raise not_found("User not found")

    return _user_response(user, user.company, permissions=current.permissions)





def _user_response(user, company, permissions: list[str] | None = None) -> UserResponse:

    perms = permissions or sorted(effective_permission_codes(user))

    return UserResponse(

        id=user.id,

        company_id=user.company_id,

        email=user.email,

        login=user.login,

        display_name=user.display_name,

        role=user.role.value,

        is_active=user.is_active,

        permissions=perms,

        company=CompanySummary(

            id=company.id,

            name=company.name,

            slug=company.slug,

            timezone=company.timezone,

        )

        if company

        else None,

    )


