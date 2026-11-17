from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, require_any_permission, require_permission
from app.core.exceptions import conflict
from app.database import get_db
from app.schemas.documents import (
    DocumentPrintRequest,
    DocumentPrintResponse,
    DocumentStationsResponse,
)
from app.services import receipt_templates as receipt_templates_service
from app.services.print_gateway import (
    PRINTER_KIND_RECEIPT,
    build_print_job,
    gateway,
    matching_printer_name,
)

router = APIRouter(prefix="/documents", tags=["documents"])


@router.get("/stations", response_model=DocumentStationsResponse)
async def list_document_stations(
    current: CurrentUser = Depends(
        require_any_permission("documents.print", "settings.manage")
    ),
    session: AsyncSession = Depends(get_db),
) -> DocumentStationsResponse:
    settings = await receipt_templates_service.get_receipt_templates(
        session, current.company_id
    )
    printer_name = settings["print"]["printer_name"]
    return DocumentStationsResponse(
        printer_name=printer_name,
        stations=gateway.list_stations(
            current.company_id, printer_name, kind=PRINTER_KIND_RECEIPT
        ),
    )


@router.post("/print", response_model=DocumentPrintResponse)
async def print_document(
    body: DocumentPrintRequest,
    current: CurrentUser = Depends(require_permission("documents.print")),
    session: AsyncSession = Depends(get_db),
) -> DocumentPrintResponse:
    settings = await receipt_templates_service.get_receipt_templates(
        session, current.company_id
    )
    template = receipt_templates_service.find_template(settings, body.template_id)
    configured_name = settings["print"]["printer_name"]
    requested_name = body.printer_name.strip() if isinstance(body.printer_name, str) else ""
    resolved_name, online_names = await gateway.resolve_printer(
        current.company_id,
        configured_name,
        body.station_id,
        PRINTER_KIND_RECEIPT,
    )
    if requested_name:
        matched = matching_printer_name(online_names, requested_name)
        if matched is None and online_names:
            raise conflict(
                f'Receipt printer "{requested_name}" is not connected.',
                "RECEIPT_PRINTER_MISMATCH",
            )
        printer_name = matched or configured_name
    elif resolved_name is None and online_names:
        listed = ", ".join(online_names)
        raise conflict(
            f'Receipt printer "{configured_name}" is not on the connected Print Service. '
            f"Connected receipt printers: {listed}.",
            "RECEIPT_PRINTER_MISMATCH",
        )
    else:
        printer_name = resolved_name or configured_name

    html = receipt_templates_service.normalize_rendered_html(body.html)
    job = build_print_job(
        template_id=template["id"],
        printer_name=printer_name,
        copies=body.copies,
        data={
            "templateId": template["id"],
            "format": template.get("format") or "80mm",
            "name": template.get("name") or "",
        },
        html=html,
        kind=PRINTER_KIND_RECEIPT,
    )
    job_ids, delivered = await gateway.enqueue(
        company_id=current.company_id,
        printer_name=printer_name,
        station_id=body.station_id,
        jobs=[job],
    )
    if delivered == 0:
        await session.commit()
        raise conflict(
            "No receipt printer is connected. Jobs stay queued until the Print Service connects.",
            "NO_RECEIPT_STATION",
        )
    return DocumentPrintResponse(
        job_ids=job_ids,
        delivered=delivered,
        pending=len(job_ids) - delivered,
    )
