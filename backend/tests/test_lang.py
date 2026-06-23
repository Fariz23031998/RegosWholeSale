from fastapi.testclient import TestClient

from app.main import create_app


def test_get_language_en():
    client = TestClient(create_app())
    response = client.get("/api/v1/lang/en")
    assert response.status_code == 200
    data = response.json()
    assert data["version"] == "1.0.0"
    assert data["translations"]["nav.sell"] == "Sell"


def test_get_language_version():
    client = TestClient(create_app())
    response = client.get("/api/v1/lang/ru/version")
    assert response.status_code == 200
    data = response.json()
    assert data["version"] == "1.0.0"
    assert "last_updated" in data


def test_get_language_unknown_defaults_to_en():
    client = TestClient(create_app())
    response = client.get("/api/v1/lang/xx")
    assert response.status_code == 200
    data = response.json()
    assert data["translations"]["nav.sell"] == "Sell"
