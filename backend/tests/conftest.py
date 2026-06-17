import os

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("SECRET_KEY", "test-secret-key")
os.environ.setdefault("RESEND_API_KEY", "")

from app.database import get_db
from app.main import app
from app.models.base import Base
from app.services.permissions import seed_permissions

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"
TEST_VERIFICATION_CODE = "123456"


@pytest.fixture(autouse=True)
def mock_verification(monkeypatch):
    monkeypatch.setattr("app.services.verification.RATE_LIMIT_MINUTES", 0)
    monkeypatch.setattr(
        "app.services.verification.generate_verification_code",
        lambda: TEST_VERIFICATION_CODE,
    )

    async def noop_send(_email: str, _code: str) -> dict:
        return {"ok": True, "result": "skipped"}

    monkeypatch.setattr("app.services.verification.send_verification_email", noop_send)


@pytest_asyncio.fixture
async def engine():
    engine = create_async_engine(TEST_DATABASE_URL, echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    await engine.dispose()


@pytest_asyncio.fixture
async def session_factory(engine):
    return async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


@pytest_asyncio.fixture
async def client(session_factory):
    async def override_get_db():
        async with session_factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    app.dependency_overrides[get_db] = override_get_db

    async with session_factory() as session:
        await seed_permissions(session)
        await session.commit()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    app.dependency_overrides.clear()
