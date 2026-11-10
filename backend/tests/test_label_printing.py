import pytest
from httpx import AsyncClient
from starlette.testclient import TestClient

from app.core.exceptions import AppError
from app.main import app
from app.services.label_render import (
    label_data_from_product,
    label_fields_from_product,
    render_labels_document,
    render_placeholders,
    sanitize_label_image_src,
)
from app.services.label_templates import (
    _normalize_html,
    _normalize_logos,
    _normalize_print_settings,
    protocol_templates,
)
from app.services.regos_prices.fetch_item_price_log.fetch_item_price_log import select_recent_prices
from app.services.print_gateway import StationConn, build_print_job, gateway
from app.services.user_label_print import _effective_settings
from helpers import register_owner


class FakeSocket:
    def __init__(self) -> None:
        self.sent: list[str] = []

    async def send_text(self, message: str) -> None:
        self.sent.append(message)


@pytest.fixture(autouse=True)
def reset_gateway():
    gateway.reset()
    yield
    gateway.reset()


def test_label_html_rejects_script() -> None:
    with pytest.raises(AppError):
        _normalize_html("<div onclick=\"alert(1)\">{{ name }}</div>")


def test_label_render_escapes_text_and_embeds_barcode() -> None:
    data = label_data_from_product(
        {
            "name": "Milk <1L>",
            "price": 12,
            "barcode": "4006381333931",
            "code": "1001",
            "articul": "ART",
            "sku": "ART",
            "category": "Dairy",
            "unit_name": "pcs",
            "image": "https://cdn.example.test/milk.png",
        },
        "UZS",
    )
    assert "Milk &lt;1L&gt;" == data["name"]
    assert data["current_price"] == ""
    assert data["old_price"] == ""
    assert data["image_src"] == "https://cdn.example.test/milk.png"
    priced = label_data_from_product(
        {"name": "Milk", "price": 12, "barcode": "4006381333931"},
        "UZS",
        (12000, 15000.5),
    )
    assert priced["price"] == "12"
    assert priced["current_price"] == "12000"
    assert priced["old_price"] == "15000.50"
    assert data["barcode_src"].startswith("data:image/png;base64,")
    assert data["qr_src"].startswith("data:image/png;base64,")
    html = render_placeholders(
        '<div>{{ name }}</div><img src="{{ barcode_src }}" /><img src="{{ image_src }}" />',
        data,
    )
    assert "<div>Milk &lt;1L&gt;</div>" in html
    assert "data:image/png;base64," in html
    assert 'src="https://cdn.example.test/milk.png"' in html
    document = render_labels_document(
        {"paper": {"width_mm": 58, "height_mm": 40}, "html": "<body><div>{{ name }}</div></body>"},
        [data],
    )
    assert "size: 58.0mm 40.0mm" in document or "size: 58mm 40mm" in document
    assert "Milk &lt;1L&gt;" in document
    styled = render_labels_document(
        {
            "paper": {"width_mm": 58, "height_mm": 40},
            "html": "<body><div class=\"name\">{{ name }}</div></body>",
            "css": ".name { color: red; }",
        },
        [data],
    )
    assert ".name { color: red; }" in styled


def test_label_image_src_sanitization() -> None:
    assert sanitize_label_image_src("https://cdn.example.test/a.png") == "https://cdn.example.test/a.png"
    assert sanitize_label_image_src("http://cdn.example.test/a.png") == "http://cdn.example.test/a.png"
    assert sanitize_label_image_src("data:image/png;base64,aaa") == "data:image/png;base64,aaa"
    assert sanitize_label_image_src("javascript:alert(1)") == ""
    assert sanitize_label_image_src("  ") == ""
    fields = label_fields_from_product(
        {"name": "X", "barcode": "1", "image": "javascript:alert(1)"},
        "UZS",
    )
    assert fields["image_src"] == ""


def test_label_logos_normalize() -> None:
    logos = _normalize_logos(
        [
            {
                "id": "logo-1",
                "name": "Primary",
                "src": "data:image/png;base64,aaa",
                "max_width": 48,
            }
        ]
    )
    assert logos == [
        {
            "id": "logo-1",
            "name": "Primary",
            "src": "data:image/png;base64,aaa",
            "max_width": 48,
        }
    ]
    with pytest.raises(AppError):
        _normalize_logos([{"name": "Bad", "src": "https://example.test/logo.png"}])
    with pytest.raises(AppError):
        _normalize_logos(
            [
                {"name": "A", "src": "data:image/png;base64,aaa"},
                {"name": "a", "src": "data:image/png;base64,bbb"},
            ]
        )


def test_legacy_print_settings_become_one_service() -> None:
    state = _normalize_print_settings({"printer_name": "Shelf", "token": "abc"})
    assert state["printer_name"] == "Shelf"
    assert state["token"] == "abc"
    assert len(state["services"]) == 1
    assert state["services"][0]["name"] == "Shelf"
    assert state["services"][0]["printer_name"] == "Shelf"
    assert state["services"][0]["is_default"] is True


def test_protocol_templates_include_css() -> None:
    html = protocol_templates(
        {
            "templates": [
                {
                    "id": "1",
                    "version": 2,
                    "paper": {"width_mm": 58, "height_mm": 40},
                    "html": "<html><head></head><body><div></div></body></html>",
                    "css": ".name { color: red; }",
                }
            ]
        }
    )[0]["html"]
    assert "<style>" in html
    assert ".name { color: red; }" in html
    assert "</head>" in html


def test_select_recent_prices_skips_duplicate_current_value() -> None:
    current, old = select_recent_prices(
        [
            {"id": 1, "last_update": 10, "value": 100},
            {"id": 2, "last_update": 20, "value": 120},
            {"id": 3, "last_update": 30, "value": 120},
        ]
    )
    assert current == 120
    assert old == 100

    only_current, missing_old = select_recent_prices([{"id": 4, "last_update": 5, "value": 80}])
    assert only_current == 80
    assert missing_old is None


@pytest.mark.asyncio
async def test_gateway_queues_when_no_station_matches() -> None:
    job = build_print_job(template_id="label", printer_name="Labels", copies=1, data={"name": "A"})
    job_ids, delivered = await gateway.enqueue(
        company_id=1,
        printer_name="Labels",
        station_id=None,
        jobs=[job],
    )
    assert delivered == 0
    assert job_ids == [job["id"]]
    assert job["id"] in gateway.jobs

    receipt_only = FakeSocket()
    await gateway.register(
        StationConn(
            company_id=1,
            station_id="pc-1",
            station_name="PC",
            location_id=None,
            printers=[{"name": "Labels", "kind": "receipt", "enabled": True}],
            websocket=receipt_only,
        )
    )
    _, still_offline = await gateway.enqueue(
        company_id=1,
        printer_name="Labels",
        station_id=None,
        jobs=[build_print_job(template_id="label", printer_name="Labels", copies=2, data={"name": "B"})],
    )
    assert still_offline == 0
    assert receipt_only.sent == []


@pytest.mark.asyncio
async def test_gateway_sends_to_matching_label_printer() -> None:
    socket = FakeSocket()
    await gateway.register(
        StationConn(
            company_id=7,
            station_id="warehouse",
            station_name="Warehouse",
            location_id=None,
            printers=[{"name": "Warehouse labels", "kind": "label", "enabled": True}],
            websocket=socket,
        )
    )
    job = build_print_job(
        template_id="tpl",
        printer_name="warehouse labels",
        copies=2,
        data={"name": "Tea"},
    )
    job_ids, delivered = await gateway.enqueue(
        company_id=7,
        printer_name="warehouse labels",
        station_id="warehouse",
        jobs=[job],
    )
    assert delivered == 1
    assert job_ids == [job["id"]]
    assert socket.sent
    assert '"type": "print"' in socket.sent[0]
    assert job["id"] in socket.sent[0]

    other = FakeSocket()
    await gateway.register(
        StationConn(
            company_id=7,
            station_id="shop",
            station_name="Shop",
            location_id=None,
            printers=[{"name": "Warehouse labels", "kind": "label", "enabled": True}],
            websocket=other,
        )
    )
    targeted = build_print_job(template_id="tpl", printer_name="Warehouse labels", copies=1, data={})
    _, delivered_one = await gateway.enqueue(
        company_id=7,
        printer_name="Warehouse labels",
        station_id="shop",
        jobs=[targeted],
    )
    assert delivered_one == 1
    assert other.sent
    assert socket.sent == [socket.sent[0]]


@pytest.mark.asyncio
async def test_pending_job_retargets_only_connected_label_printer() -> None:
    job = build_print_job(template_id="label", printer_name="Labels", copies=1, data={"name": "A"})
    _, delivered = await gateway.enqueue(
        company_id=1,
        printer_name="Labels",
        station_id=None,
        jobs=[job],
    )
    assert delivered == 0

    printers = [{"name": "Xprinter", "kind": "label", "enabled": True}]
    await gateway.register(
        StationConn(
            company_id=1,
            station_id="pc-1",
            station_name="PC",
            location_id=None,
            printers=printers,
            websocket=FakeSocket(),
        )
    )
    pending = await gateway.pending_payloads(1, "pc-1", printers)
    assert pending[0]["printerName"] == "Xprinter"
    assert gateway.jobs[job["id"]].printer_name == "Xprinter"

    receipt = [{"name": "Labels", "kind": "receipt", "enabled": True}]
    assert await gateway.pending_payloads(1, "desk", receipt) == []


@pytest.mark.asyncio
async def test_resolve_label_printer_prefers_configured_name() -> None:
    for station_id, printer_name in (("alpha", "Alpha"), ("labels", "Labels")):
        await gateway.register(
            StationConn(
                company_id=1,
                station_id=station_id,
                station_name=station_id,
                location_id=None,
                printers=[{"name": printer_name, "kind": "label", "enabled": True}],
                websocket=FakeSocket(),
            )
        )
    resolved, names = await gateway.resolve_label_printer(1, "Labels", None)
    assert resolved == "Labels"
    assert names == ["Alpha", "Labels"]

    ambiguous, ambiguous_names = await gateway.resolve_label_printer(1, "Shelf", None)
    assert ambiguous is None
    assert ambiguous_names == ["Alpha", "Labels"]


@pytest.mark.asyncio
async def test_label_templates_seed_patch_and_reject_script(client: AsyncClient) -> None:
    reg = await register_owner(client, email="labels@test.com", company_name="Label Co")
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    response = await client.get("/api/v1/company/settings/label-templates", headers=headers)
    assert response.status_code == 200
    settings = response.json()["settings"]
    assert len(settings["templates"]) == 1
    assert settings["templates"][0]["paper"]["width_mm"] == 58
    assert settings["print"]["printer_name"] == "Labels"
    assert settings["print"]["token"]
    assert len(settings["print"]["services"]) == 1
    assert settings["print"]["services"][0]["is_default"] is True
    assert settings["print"]["services"][0]["printer_name"] == "Labels"
    assert settings["templates"][0]["css"]

    templates = settings["templates"]
    templates[0]["name"] = "Shelf label"
    patched = await client.patch(
        "/api/v1/company/settings/label-templates",
        headers=headers,
        json={"templates": templates, "default_template_id": templates[0]["id"]},
    )
    assert patched.status_code == 200
    assert patched.json()["settings"]["templates"][0]["name"] == "Shelf label"

    templates[0]["html"] = "<script>alert(1)</script>"
    rejected = await client.patch(
        "/api/v1/company/settings/label-templates",
        headers=headers,
        json={"templates": templates},
    )
    assert rejected.status_code == 400

    renamed = await client.patch(
        "/api/v1/company/settings/label-print",
        headers=headers,
        json={"printer_name": "Warehouse labels"},
    )
    assert renamed.status_code == 200
    assert renamed.json()["settings"]["print"]["printer_name"] == "Warehouse labels"
    default_service = next(
        item for item in renamed.json()["settings"]["print"]["services"] if item["is_default"]
    )
    assert default_service["printer_name"] == "Warehouse labels"

    added = await client.patch(
        "/api/v1/company/settings/label-print",
        headers=headers,
        json={
            "services": [
                default_service,
                {
                    "id": "shop-service",
                    "name": "Shop",
                    "printer_name": "Shop labels",
                    "is_default": False,
                },
            ]
        },
    )
    assert added.status_code == 200
    added_services = added.json()["settings"]["print"]["services"]
    assert [item["printer_name"] for item in added_services] == ["Warehouse labels", "Shop labels"]
    assert added.json()["settings"]["print"]["printer_name"] == "Warehouse labels"

    stations = await client.get("/api/v1/labels/stations", headers=headers)
    assert stations.status_code == 200
    assert stations.json()["stations"] == []

    missing = await client.post(
        "/api/v1/labels/print",
        headers=headers,
        json={"product_ids": [1], "copies": 1},
    )
    assert missing.status_code in {400, 409, 502}


def test_print_job_carries_rendered_html() -> None:
    job = build_print_job(
        template_id="tpl",
        printer_name="Labels",
        copies=2,
        data={"name": "Tea"},
        html="<div>{{ name }}</div>",
    )
    assert job["html"] == "<div>{{ name }}</div>"
    assert job["copies"] == 2
    assert job["data"] == {"name": "Tea"}
    plain = build_print_job(template_id="tpl", printer_name="Labels", copies=1, data={})
    assert "html" not in plain


@pytest.mark.asyncio
async def test_label_sample_row_is_not_escaped(client: AsyncClient) -> None:
    reg = await register_owner(client, email="label-sample@test.com", company_name="Label Sample")
    token = reg.json()["access_token"]
    response = await client.post(
        "/api/v1/labels/sample-row",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    row = response.json()["row"]
    assert row["name"] == "Sample product"
    assert row["price"] == "12000"
    assert row["barcode_src"].startswith("data:image/png;base64,")
    assert row["qr_src"].startswith("data:image/png;base64,")


def test_print_gateway_rejects_bad_token(client: AsyncClient) -> None:
    del client
    with TestClient(app) as sync_client:
        with sync_client.websocket_connect("/print-gateway/ws") as websocket:
            websocket.send_json({"type": "auth", "token": "nope", "stationId": "pc"})
            message = websocket.receive_json()
            assert message["type"] == "auth_failed"


def test_effective_user_label_print_keeps_printer_name() -> None:
    company = {
        "templates": [{"id": "tpl-1", "name": "Default"}],
        "default_template_id": "tpl-1",
        "print": {
            "services": [
                {"id": "svc-1", "name": "Labels", "printer_name": "Labels", "is_default": True}
            ]
        },
    }
    effective = _effective_settings(
        company,
        {
            "template_id": "tpl-1",
            "service_id": "svc-1",
            "printer_name": "  Xprinter  ",
            "method": "service",
            "prompt_before_print": False,
            "use_warehouse_quantity": True,
        },
    )
    assert effective["printer_name"] == "Xprinter"
    assert effective["prompt_before_print"] is False
    assert effective["use_warehouse_quantity"] is True

    cleared = _effective_settings(
        company,
        {
            "template_id": "tpl-1",
            "service_id": "svc-1",
            "printer_name": "   ",
            "method": "service",
            "prompt_before_print": True,
            "use_warehouse_quantity": False,
        },
    )
    assert cleared["printer_name"] is None
    assert cleared["use_warehouse_quantity"] is False

    missing = _effective_settings(company, {"template_id": "tpl-1", "service_id": "svc-1"})
    assert missing["printer_name"] is None
    assert missing["use_warehouse_quantity"] is False


@pytest.mark.asyncio
async def test_user_label_print_settings_persist_printer_name(client: AsyncClient) -> None:
    reg = await register_owner(client, email="label-printer-pref@test.com", company_name="Label Pref")
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    company = await client.get("/api/v1/company/settings/label-templates", headers=headers)
    assert company.status_code == 200
    template_id = company.json()["settings"]["templates"][0]["id"]
    service_id = company.json()["settings"]["print"]["services"][0]["id"]

    patched = await client.patch(
        "/api/v1/me/settings/label-print",
        headers=headers,
        json={
            "template_id": template_id,
            "service_id": service_id,
            "printer_name": "Xprinter",
            "method": "service",
            "prompt_before_print": False,
            "use_warehouse_quantity": True,
        },
    )
    assert patched.status_code == 200
    assert patched.json()["settings"]["printer_name"] == "Xprinter"
    assert patched.json()["settings"]["use_warehouse_quantity"] is True

    loaded = await client.get("/api/v1/me/settings/label-print", headers=headers)
    assert loaded.status_code == 200
    assert loaded.json()["settings"]["printer_name"] == "Xprinter"
    assert loaded.json()["settings"]["use_warehouse_quantity"] is True

    cleared = await client.patch(
        "/api/v1/me/settings/label-print",
        headers=headers,
        json={
            "template_id": template_id,
            "service_id": service_id,
            "printer_name": "",
            "method": "service",
            "prompt_before_print": False,
            "use_warehouse_quantity": False,
        },
    )
    assert cleared.status_code == 200
    assert cleared.json()["settings"]["printer_name"] is None
    assert cleared.json()["settings"]["use_warehouse_quantity"] is False
