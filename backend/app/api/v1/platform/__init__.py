from fastapi import APIRouter

from app.api.v1.platform import admins, auth, companies

router = APIRouter(prefix="/platform")
router.include_router(auth.router)
router.include_router(admins.router)
router.include_router(companies.router)
