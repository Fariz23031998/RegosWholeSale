import asyncio
import json
import logging

from fastapi import WebSocket, WebSocketDisconnect

from app import database as database_module
from app.services import label_templates as label_templates_service
from app.services.print_gateway import StationConn, gateway, normalize_protocol_printers

logger = logging.getLogger(__name__)
AUTH_TIMEOUT_SECONDS = 10
PING_INTERVAL_SECONDS = 30


async def print_gateway_ws(websocket: WebSocket) -> None:
    await websocket.accept()
    station: StationConn | None = None
    ping_task: asyncio.Task | None = None
    try:
        raw = await asyncio.wait_for(websocket.receive_text(), AUTH_TIMEOUT_SECONDS)
        message = _parse_message(raw)
        if not message or message.get("type") != "auth":
            await _send_json(websocket, {"type": "auth_failed", "message": "auth_required"})
            await websocket.close()
            return

        token = message.get("token")
        station_id = message.get("stationId")
        if not isinstance(token, str) or not isinstance(station_id, str) or not station_id.strip():
            await _send_json(websocket, {"type": "auth_failed", "message": "invalid_token"})
            await websocket.close()
            return

        async with database_module.async_session_factory() as session:
            company_id = await label_templates_service.company_id_for_print_token(session, token)
            if company_id is None:
                await _send_json(websocket, {"type": "auth_failed", "message": "invalid_token"})
                await websocket.close()
                return
            settings = await label_templates_service.get_label_settings(session, company_id)
            await session.commit()

        printers = normalize_protocol_printers(message.get("printers"))
        station_name = message.get("stationName")
        location_id = message.get("locationId")
        station = StationConn(
            company_id=company_id,
            station_id=station_id.strip(),
            station_name=station_name.strip() if isinstance(station_name, str) else "",
            location_id=location_id.strip() if isinstance(location_id, str) and location_id.strip() else None,
            printers=printers,
            websocket=websocket,
        )
        await gateway.register(station)
        pending = await gateway.pending_payloads(company_id, station.station_id, printers)
        await _send_json(
            websocket,
            {
                "type": "hello",
                "templates": label_templates_service.protocol_templates(settings),
                "jobs": pending,
            },
        )
        ping_task = asyncio.create_task(_ping_loop(websocket))

        while True:
            incoming = _parse_message(await websocket.receive_text())
            if not incoming:
                continue
            kind = incoming.get("type")
            if kind == "printers":
                printers = normalize_protocol_printers(incoming.get("printers"))
                station.printers = printers
                await gateway.update_printers(company_id, station.station_id, printers)
            elif kind == "result":
                job_id = incoming.get("jobId")
                if isinstance(job_id, str) and job_id:
                    await gateway.acknowledge(company_id, job_id)
            elif kind == "ping":
                await _send_json(websocket, {"type": "pong"})
    except (WebSocketDisconnect, TimeoutError, asyncio.TimeoutError):
        return
    except Exception:
        logger.exception("Print gateway connection failed")
    finally:
        if ping_task is not None:
            ping_task.cancel()
        if station is not None:
            await gateway.unregister(station.company_id, station.station_id, websocket)


async def _ping_loop(websocket: WebSocket) -> None:
    try:
        while True:
            await asyncio.sleep(PING_INTERVAL_SECONDS)
            await _send_json(websocket, {"type": "ping"})
    except Exception:
        return


def _parse_message(raw: str) -> dict | None:
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


async def _send_json(websocket: WebSocket, payload: dict) -> None:
    await websocket.send_text(json.dumps(payload))
