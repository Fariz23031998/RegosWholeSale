from fastapi import APIRouter

from app.api.v1 import auth, dashboard, lang, permissions, regos, regos_webhook, sales, settings, telegram, users

api_router = APIRouter()
api_router.include_router(lang.router)
api_router.include_router(auth.router)
api_router.include_router(permissions.router)
api_router.include_router(users.router)
api_router.include_router(settings.router)
api_router.include_router(regos.router)
api_router.include_router(regos_webhook.router)
api_router.include_router(sales.router)
api_router.include_router(dashboard.router)
api_router.include_router(telegram.router)
