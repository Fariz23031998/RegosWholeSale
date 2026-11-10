from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, require_any_permission, require_permission
from app.core.exceptions import bad_request, conflict
from app.database import get_db
from app.schemas.labels import (
    LabelFieldRow,
    LabelPreviewRequest,
    LabelPrintRequest,
    LabelPrintResponse,
    LabelRenderRequest,
    LabelRenderResponse,
    LabelRowsResponse,
    LabelSampleRowResponse,
    LabelStationsResponse,
)
from app.services import label_render
from app.services import label_templates as label_templates_service
from app.services import regos_defaults as regos_defaults_service
from app.services import regos_products as regos_products_service
from app.services.print_gateway import build_print_job, gateway, matching_printer_name
from app.services.regos_prices.fetch_item_price_log.fetch_item_price_log import fetch_item_price_logs

router = APIRouter(prefix="/labels", tags=["labels"])


@router.get("/stations", response_model=LabelStationsResponse)
async def list_label_stations(
    current: CurrentUser = Depends(require_any_permission("labels.print", "settings.manage")),
    session: AsyncSession = Depends(get_db),
) -> LabelStationsResponse:
    settings = await label_templates_service.get_label_settings(session, current.company_id)
    printer_name = settings["print"]["printer_name"]
    return LabelStationsResponse(
        printer_name=printer_name,
        stations=gateway.list_stations(current.company_id, printer_name),
    )


@router.post("/preview", response_model=LabelRenderResponse)
async def preview_label_template(
    body: LabelPreviewRequest,
    current: CurrentUser = Depends(require_permission("settings.manage")),
) -> LabelRenderResponse:
    template = {
        "paper": {"width_mm": body.width_mm, "height_mm": body.height_mm},
        "html": body.html,
        "css": body.css,
    }
    label_templates_service._normalize_html(body.html)
    label_templates_service._normalize_css(body.css)
    fragment = label_render.render_labels_document(template, [label_render.sample_label_data()])
    return LabelRenderResponse(
        html=label_render.wrap_preview_document(fragment),
        width_mm=body.width_mm,
        height_mm=body.height_mm,
        count=1,
    )


@router.post("/sample-row", response_model=LabelSampleRowResponse)
async def sample_label_row(
    current: CurrentUser = Depends(require_permission("settings.manage")),
) -> LabelSampleRowResponse:
    return LabelSampleRowResponse(row=LabelFieldRow(**label_render.sample_label_fields()))


@router.post("/rows", response_model=LabelRowsResponse)
async def list_label_rows(
    body: LabelRenderRequest,
    current: CurrentUser = Depends(require_permission("labels.print")),
    session: AsyncSession = Depends(get_db),
) -> LabelRowsResponse:
    template, rows, quantities = await _load_label_rows(
        session, current, body, expand_copies=False, raw=True
    )
    paper = template["paper"]
    return LabelRowsResponse(
        html=template.get("html") or "",
        css=template.get("css") or "",
        width_mm=float(paper["width_mm"]),
        height_mm=float(paper["height_mm"]),
        logos=template.get("logos") or [],
        rows=[LabelFieldRow(**row) for row in rows],
        quantities=quantities,
    )


@router.post("/render", response_model=LabelRenderResponse)
async def render_product_labels(
    body: LabelRenderRequest,
    current: CurrentUser = Depends(require_permission("labels.print")),
    session: AsyncSession = Depends(get_db),
) -> LabelRenderResponse:
    template, rows, _quantities = await _load_label_rows(session, current, body, expand_copies=True)
    fragment = label_render.render_labels_document(template, rows)
    paper = template["paper"]
    return LabelRenderResponse(
        html=fragment,
        width_mm=float(paper["width_mm"]),
        height_mm=float(paper["height_mm"]),
        count=len(rows),
    )


@router.post("/print", response_model=LabelPrintResponse)
async def print_product_labels(
    body: LabelPrintRequest,
    current: CurrentUser = Depends(require_permission("labels.print")),
    session: AsyncSession = Depends(get_db),
) -> LabelPrintResponse:
    settings = await label_templates_service.get_label_settings(session, current.company_id)
    template, rows, quantities = await _load_label_rows(
        session, current, body, settings=settings, expand_copies=False
    )
    configured_name = settings["print"]["printer_name"]
    requested_name = body.printer_name.strip() if isinstance(body.printer_name, str) else ""
    resolved_name, online_names = await gateway.resolve_label_printer(
        current.company_id,
        configured_name,
        body.station_id,
    )
    if requested_name:
        matched = matching_printer_name(online_names, requested_name)
        if matched is None and online_names:
            raise conflict(
                f'Label printer "{requested_name}" is not connected.',
                "LABEL_PRINTER_MISMATCH",
            )
        printer_name = matched or configured_name
    elif resolved_name is None and online_names:
        listed = ", ".join(online_names)
        raise conflict(
            f'Label printer "{configured_name}" is not on the connected Print Service. '
            f"Connected label printers: {listed}.",
            "LABEL_PRINTER_MISMATCH",
        )
    else:
        printer_name = resolved_name or configured_name
    if body.html_pages is None:
        pages: list[str | None] = [None] * len(rows)
    elif len(body.html_pages) != len(rows):
        raise bad_request("Label HTML count does not match products.", "INVALID_LABEL_HTML")
    else:
        pages = [label_templates_service.normalize_rendered_html(page) for page in body.html_pages]
    jobs = []
    for row, page, quantity in zip(rows, pages, quantities):
        copies = quantity if body.use_warehouse_quantity else body.copies
        if copies < 1:
            continue
        jobs.append(
            build_print_job(
                template_id=template["id"],
                printer_name=printer_name,
                copies=copies,
                data=row,
                html=page,
            )
        )
    if not jobs:
        raise bad_request(
            "No labels to print for the selected warehouse quantity.",
            "NO_LABEL_QUANTITY",
        )
    job_ids, delivered = await gateway.enqueue(
        company_id=current.company_id,
        printer_name=printer_name,
        station_id=body.station_id,
        jobs=jobs,
    )
    if delivered == 0:
        await session.commit()
        raise conflict(
            "No label printer is connected. Jobs stay queued until the Print Service connects.",
            "NO_LABEL_STATION",
        )
    return LabelPrintResponse(
        job_ids=job_ids,
        delivered=delivered,
        pending=len(job_ids) - delivered,
    )


def _stock_quantity(product: dict) -> int:
    try:
        stock = float(product.get("stock") or 0)
    except (TypeError, ValueError):
        stock = 0.0
    if stock < 1:
        return 0
    return min(99, int(stock))


async def _load_label_rows(
    session: AsyncSession,
    current: CurrentUser,
    body: LabelRenderRequest | LabelPrintRequest,
    settings: dict | None = None,
    *,
    expand_copies: bool,
    raw: bool = False,
) -> tuple[dict, list[dict[str, str]], list[int]]:
    await regos_defaults_service.assert_catalog_scope_allowed(
        session,
        current.company_id,
        current.id,
        current.permissions,
        warehouse_id=body.warehouse_id,
        price_type_id=body.price_type_id,
    )
    if settings is None:
        settings = await label_templates_service.get_label_settings(session, current.company_id)
    template = label_templates_service.find_template(settings, body.template_id)
    product_ids = [product_id for product_id in dict.fromkeys(body.product_ids) if product_id > 0]
    products = await regos_products_service.get_products_by_ids(
        session,
        current.company_id,
        current.id,
        product_ids,
        warehouse_id=body.warehouse_id,
        price_type_id=body.price_type_id,
    )
    if len(products) != len(product_ids):
        raise bad_request("One or more products could not be loaded.", "LABEL_PRODUCTS_NOT_FOUND")
    defaults = await regos_defaults_service.get_effective_enriched_regos_defaults(
        session, current.id, current.company_id
    )
    currency = label_render.currency_label(defaults.get("currency"))
    price_logs = (
        await fetch_item_price_logs(session, current.company_id, product_ids, body.price_type_id)
        if body.price_type_id
        else {}
    )
    by_id = {int(product["regos_item_id"]): product for product in products}
    ordered = [by_id[product_id] for product_id in product_ids]
    quantities = [_stock_quantity(product) for product in ordered]
    use_warehouse_quantity = bool(getattr(body, "use_warehouse_quantity", False))
    if expand_copies:
        if use_warehouse_quantity:
            repeats = [max(0, quantity) for quantity in quantities]
        else:
            repeats = [body.copies for _ in ordered]
    else:
        repeats = [1 for _ in ordered]
    build_row = label_render.label_fields_from_product if raw else label_render.label_data_from_product
    rows = [
        build_row(
            product,
            currency,
            price_logs.get(int(product["regos_item_id"])),
        )
        for product, repeat in zip(ordered, repeats)
        for _ in range(repeat)
    ]
    return template, rows, quantities
