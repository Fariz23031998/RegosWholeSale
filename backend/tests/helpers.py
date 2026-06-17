from httpx import AsyncClient

TEST_VERIFICATION_CODE = "123456"


async def send_register_code(client: AsyncClient, email: str) -> None:
    response = await client.post(
        "/api/v1/auth/send-verification-code",
        json={"email": email, "type": "register"},
    )
    assert response.status_code == 200


async def register_owner(
    client: AsyncClient,
    *,
    email: str,
    password: str = "password123",
    display_name: str = "Owner",
    company_name: str = "Test Co",
):
    await send_register_code(client, email)
    return await client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": password,
            "display_name": display_name,
            "company_name": company_name,
            "verification_code": TEST_VERIFICATION_CODE,
        },
    )
