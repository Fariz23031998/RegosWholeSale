import sys
from pathlib import Path

if __name__ == "__main__" and __package__ is None:
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.v1.router import api_router
from app.config import get_settings
from app.core.exceptions import AppError
from app.database import async_session_factory, init_db
from app.services.permissions import seed_permissions
from app.core.regos_oauth import regos_oauth_configured, regos_oauth_service
from app.services.verification import clean_verification_data
from app.services.out_of_stock_products import clean_out_of_stock_products
from app.services import telegram as telegram_service

logger = logging.getLogger("regos.backend")


async def _scheduled_cleanup_loop() -> None:
    while True:
        await asyncio.sleep(600)
        try:
            async with async_session_factory() as session:
                await clean_verification_data(session)
                await clean_out_of_stock_products(session)
                await session.commit()
        except Exception:
            pass


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await init_db()
    async with async_session_factory() as session:
        await seed_permissions(session)
        from app.services.platform_admin import bootstrap_platform_admin

        await bootstrap_platform_admin(session)
        await session.commit()
    try:
        async with async_session_factory() as session:
            await telegram_service.sync_all_bot_webhooks(session)
    except Exception:
        logger.warning("Telegram webhook startup sync failed", exc_info=True)
    if regos_oauth_configured():
        try:
            await regos_oauth_service.acquire_access_token(force=True)
        except Exception:
            logger.warning("Regos OAuth startup token acquisition failed", exc_info=True)
    cleanup_task = asyncio.create_task(_scheduled_cleanup_loop())
    yield
    cleanup_task.cancel()
    try:
        await cleanup_task
    except asyncio.CancelledError:
        pass


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="Regos Wholesale API", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(AppError)
    async def app_error_handler(_request: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": exc.detail["detail"], "code": exc.code},
        )

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(api_router, prefix="/api/v1")
    return app


app = create_app()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000)