from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.schemas.users import PermissionResponse
from app.services.permissions import get_all_permissions

router = APIRouter(prefix="/permissions", tags=["permissions"])


@router.get("", response_model=list[PermissionResponse])
async def list_permissions(
    _: object = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> list[PermissionResponse]:
    perms = await get_all_permissions(session)
    return [PermissionResponse(id=p.id, code=p.code, description=p.description) for p in perms]
