import asyncio
import json
import uuid
from dataclasses import dataclass, field
from typing import Any


def _names_match(left: str | None, right: str | None) -> bool:
    return (left or "").strip().casefold() == (right or "").strip().casefold()


def matching_printer_name(names: list[str], printer_name: str) -> str | None:
    for name in names:
        if _names_match(name, printer_name):
            return name
    return None


@dataclass
class StationConn:
    company_id: int
    station_id: str
    station_name: str
    location_id: str | None
    printers: list[dict[str, Any]]
    websocket: Any


@dataclass
class PendingJob:
    id: str
    company_id: int
    printer_name: str
    station_id: str | None
    payload: dict[str, Any]


@dataclass
class PrintGateway:
    stations: dict[str, StationConn] = field(default_factory=dict)
    jobs: dict[str, PendingJob] = field(default_factory=dict)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    def reset(self) -> None:
        self.stations.clear()
        self.jobs.clear()

    async def register(self, station: StationConn) -> None:
        async with self.lock:
            self.stations[self._key(station.company_id, station.station_id)] = station

    async def unregister(self, company_id: int, station_id: str, websocket: Any) -> None:
        async with self.lock:
            key = self._key(company_id, station_id)
            current = self.stations.get(key)
            if current is not None and current.websocket is websocket:
                self.stations.pop(key, None)

    async def update_printers(
        self, company_id: int, station_id: str, printers: list[dict[str, Any]]
    ) -> None:
        async with self.lock:
            current = self.stations.get(self._key(company_id, station_id))
            if current is not None:
                current.printers = printers

    async def pending_payloads(
        self, company_id: int, station_id: str, printers: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        async with self.lock:
            payloads: list[dict[str, Any]] = []
            for job in self.jobs.values():
                if job.company_id != company_id:
                    continue
                if job.station_id and job.station_id != station_id:
                    continue
                scoped = self._company_stations(company_id, job.station_id)
                resolved = _resolve_label_printer_name(scoped, job.printer_name)
                if resolved is None or not _has_label_printer(printers, resolved):
                    continue
                if not _names_match(job.printer_name, resolved):
                    job.printer_name = resolved
                    job.payload = {**job.payload, "printerName": resolved}
                payloads.append(job.payload)
            return payloads

    async def resolve_label_printer(
        self, company_id: int, printer_name: str, station_id: str | None
    ) -> tuple[str | None, list[str]]:
        async with self.lock:
            stations = self._company_stations(company_id, station_id)
            return _resolve_label_printer_name(stations, printer_name), _online_label_names(stations)

    def _company_stations(self, company_id: int, station_id: str | None) -> list[StationConn]:
        return [
            station
            for station in self.stations.values()
            if station.company_id == company_id
            and (not station_id or station.station_id == station_id)
        ]

    async def enqueue(
        self,
        *,
        company_id: int,
        printer_name: str,
        station_id: str | None,
        jobs: list[dict[str, Any]],
    ) -> tuple[list[str], int]:
        async with self.lock:
            stored: list[PendingJob] = []
            for payload in jobs:
                job = PendingJob(
                    id=str(payload["id"]),
                    company_id=company_id,
                    printer_name=printer_name,
                    station_id=station_id,
                    payload=payload,
                )
                self.jobs[job.id] = job
                stored.append(job)
            targets = [
                station
                for station in self.stations.values()
                if station.company_id == company_id
                and (station_id is None or station.station_id == station_id)
            ]
        delivered = 0
        for job in stored:
            if await self._send_job(job, targets):
                delivered += 1
        return [job.id for job in stored], delivered

    async def acknowledge(self, company_id: int, job_id: str) -> None:
        async with self.lock:
            job = self.jobs.get(job_id)
            if job is not None and job.company_id == company_id:
                self.jobs.pop(job_id, None)

    async def broadcast_templates(self, company_id: int, templates: list[dict[str, Any]]) -> None:
        message = json.dumps({"type": "templates", "templates": templates})
        async with self.lock:
            stations = [station for station in self.stations.values() if station.company_id == company_id]
        for station in stations:
            await _safe_send(station.websocket, message)

    def list_stations(self, company_id: int, printer_name: str) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for station in self.stations.values():
            if station.company_id != company_id:
                continue
            printers = [_public_printer(printer) for printer in station.printers]
            rows.append(
                {
                    "station_id": station.station_id,
                    "station_name": station.station_name,
                    "location_id": station.location_id,
                    "online": True,
                    "matches_printer": _has_label_printer(station.printers, printer_name),
                    "printers": printers,
                }
            )
        rows.sort(key=lambda item: (item["station_name"] or "", item["station_id"]))
        return rows

    async def _send_job(self, job: PendingJob, stations: list[StationConn]) -> bool:
        message = json.dumps({"type": "print", "job": job.payload})
        sent = False
        for station in stations:
            if not _station_matches(station, job):
                continue
            if await _safe_send(station.websocket, message):
                sent = True
        return sent

    @staticmethod
    def _key(company_id: int, station_id: str) -> str:
        return f"{company_id}:{station_id}"


def build_print_job(
    *,
    template_id: str,
    printer_name: str,
    copies: int,
    data: dict[str, Any],
    html: str | None = None,
) -> dict[str, Any]:
    job: dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "kind": "label",
        "printerName": printer_name,
        "templateId": template_id,
        "copies": max(1, min(int(copies), 99)),
        "data": data,
    }
    if html:
        job["html"] = html
    return job


def normalize_protocol_printers(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    printers: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        name = item.get("name")
        kind = item.get("kind")
        if not isinstance(name, str) or not name.strip():
            continue
        if not isinstance(kind, str) or not kind.strip():
            continue
        printers.append(
            {
                "name": name.strip(),
                "kind": kind.strip().lower(),
                "enabled": bool(item.get("enabled", True)),
            }
        )
    return printers


def _station_matches(station: StationConn, job: PendingJob) -> bool:
    if station.company_id != job.company_id:
        return False
    if job.station_id and station.station_id != job.station_id:
        return False
    return _has_label_printer(station.printers, job.printer_name)


def _enabled_label_names(printers: list[dict[str, Any]]) -> list[str]:
    names: list[str] = []
    for printer in printers:
        if not printer.get("enabled"):
            continue
        if str(printer.get("kind") or "").lower() != "label":
            continue
        name = str(printer.get("name") or "").strip()
        if name:
            names.append(name)
    return names


def _online_label_names(stations: list[StationConn]) -> list[str]:
    names: list[str] = []
    seen: set[str] = set()
    for station in stations:
        for name in _enabled_label_names(station.printers):
            key = name.casefold()
            if key in seen:
                continue
            seen.add(key)
            names.append(name)
    return names


def _resolve_label_printer_name(stations: list[StationConn], printer_name: str) -> str | None:
    names = _online_label_names(stations)
    for name in names:
        if _names_match(name, printer_name):
            return name
    if len(names) == 1:
        return names[0]
    return None


def _has_label_printer(printers: list[dict[str, Any]], printer_name: str) -> bool:
    return any(_names_match(name, printer_name) for name in _enabled_label_names(printers))


def _public_printer(printer: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": str(printer.get("name") or ""),
        "kind": str(printer.get("kind") or ""),
        "enabled": bool(printer.get("enabled")),
    }


async def _safe_send(websocket: Any, message: str) -> bool:
    if websocket is None:
        return False
    try:
        await websocket.send_text(message)
    except Exception:
        return False
    return True


gateway = PrintGateway()
