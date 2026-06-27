from app.utils.regos_integration_token import extract_integration_token

TOKEN = "031db86123954995958543d9d1123456"


def test_extract_integration_token_from_full_url() -> None:
    assert (
        extract_integration_token(f"https://integration.regos.uz/gateway/out/{TOKEN}")
        == TOKEN
    )


def test_extract_integration_token_from_url_with_api_path() -> None:
    assert (
        extract_integration_token(
            f"https://integration.regos.uz/gateway/out/{TOKEN}/v1/item/get"
        )
        == TOKEN
    )


def test_extract_integration_token_returns_raw_token() -> None:
    assert extract_integration_token(f"  {TOKEN}  ") == TOKEN


def test_extract_integration_token_returns_empty_for_blank() -> None:
    assert extract_integration_token("   ") == ""
