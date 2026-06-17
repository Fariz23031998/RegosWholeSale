from fastapi import APIRouter

from app.api.v1 import auth, permissions, regos, sales, settings, users

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(permissions.router)
api_router.include_router(users.router)
api_router.include_router(settings.router)
api_router.include_router(regos.router)
api_router.include_router(sales.router)
