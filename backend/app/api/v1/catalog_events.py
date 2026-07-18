import asyncio
import json
from collections.abc import AsyncIterator
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, bearer_scheme
from app.core.exceptions import unauthorized
from app.core.security import decode_access_token, token_type
from app.database import get_db
from app.services.catalog_events import get_catalog_event_hub
from app.services.permissions import effective_permission_codes, get_user_with_permissions, has_permission
from app.services.subscriptions import is_subscription_active

router = APIRouter(prefix="/regos", tags=["regos"])

SSE_HEARTBEAT_SECONDS = 30


def _sse_heartbeat_frame() -> str:
    occurred_at = (
        datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    )
    return f"data: {json.dumps({'type': 'heartbeat', 'occurred_at': occurred_at}, separators=(',', ':'))}\n\n"

async def get_current_user_for_sse(
    access_token: str | None = Query(default=None, max_length=4096),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    session: AsyncSession = Depends(get_db),
) -> CurrentUser:
    token: str | None = None
    if credentials and credentials.scheme.lower() == "bearer":
        token = credentials.credentials
    elif access_token and access_token.strip():
        token = access_token.strip()

    if not token:
        raise unauthorized("Not authenticated", "NOT_AUTHENTICATED")

    try:
        payload = decode_access_token(token)
    except ValueError:
        raise unauthorized("Invalid token", "INVALID_TOKEN")

    if token_type(payload) == "platform":
        raise unauthorized("Invalid token", "INVALID_TOKEN")

    user_id = int(payload["sub"])
    user = await get_user_with_permissions(session, user_id)
    if not user or not user.is_active:
        raise unauthorized("Invalid token", "INVALID_TOKEN")

    if not is_subscription_active(user.company):
        from app.core.exceptions import forbidden

        raise forbidden("Subscription has expired", "SUBSCRIPTION_EXPIRED")

    perms = sorted(effective_permission_codes(user))
    if not has_permission(perms, "pos.access"):
        from app.core.exceptions import forbidden

        raise forbidden("Missing permission: pos.access", "FORBIDDEN")

    return CurrentUser(
        id=user.id,
        company_id=user.company_id,
        role=user.role.value,
        permissions=perms,
    )


async def _catalog_event_stream(company_id: int) -> AsyncIterator[str]:
    hub = get_catalog_event_hub()
    subscription = hub.subscribe(company_id)
    iterator = subscription.__aiter__()
    while True:
        try:
            event = await asyncio.wait_for(iterator.__anext__(), timeout=SSE_HEARTBEAT_SECONDS)
        except asyncio.TimeoutError:
            yield _sse_heartbeat_frame()
            continue
        except StopAsyncIteration:
            break
        yield f"data: {json.dumps(event, separators=(',', ':'))}\n\n"


@router.get("/catalog-events")
async def stream_catalog_events(
    current: CurrentUser = Depends(get_current_user_for_sse),
) -> StreamingResponse:
    return StreamingResponse(
        _catalog_event_stream(current.company_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
