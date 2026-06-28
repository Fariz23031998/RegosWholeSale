"""Regos API batch requests — up to 50 steps per HTTP call.

See https://docs.regos.uz/uz/api/intro/batch
"""

from __future__ import annotations

from typing import Any, TypedDict

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppError
from app.core.regos_api import regos_async_api_request_for_company

REGOS_BATCH_MAX_STEPS = 50
REGOS_BATCH_ENDPOINT = "batch"


class BatchStep(TypedDict):
    key: str
    path: str
    payload: dict[str, Any] | list


def chunk_batch_steps(
    steps: list[BatchStep],
    *,
    max_steps: int = REGOS_BATCH_MAX_STEPS,
) -> list[list[BatchStep]]:
    if max_steps < 1:
        raise ValueError("max_steps must be at least 1")
    return [steps[index : index + max_steps] for index in range(0, len(steps), max_steps)]


def _extract_step_response(
    step_result: dict[str, Any],
    *,
    step_key: str,
    stop_on_error: bool,
) -> dict[str, Any] | None:
    response = step_result.get("response")
    if not isinstance(response, dict):
        if stop_on_error:
            raise AppError(
                502,
                f"REGOS batch step {step_key} returned an invalid response",
                "REGOS_BATCH_ERROR",
            )
        return None
    if not response.get("ok"):
        if stop_on_error:
            err_result = response.get("result", {})
            if isinstance(err_result, dict):
                error_code = err_result.get("error", "Unknown")
                error_desc = err_result.get("description", "Unknown error")
                err_msg = f"REGOS batch step {step_key} failed: {error_code} - {error_desc}"
            else:
                err_msg = f"REGOS batch step {step_key} failed"
            raise AppError(400, err_msg, "REGOS_BATCH_ERROR")
        return response
    return response


async def regos_batch_request_for_company(
    session: AsyncSession,
    company_id: int,
    steps: list[BatchStep],
    *,
    stop_on_error: bool = False,
    timeout_seconds: int = 120,
) -> dict[str, dict[str, Any]]:
    if not steps:
        return {}
    if len(steps) > REGOS_BATCH_MAX_STEPS:
        raise AppError(
            400,
            f"REGOS batch supports at most {REGOS_BATCH_MAX_STEPS} steps per request",
            "REGOS_BATCH_TOO_MANY_STEPS",
        )

    data = await regos_async_api_request_for_company(
        session,
        company_id,
        REGOS_BATCH_ENDPOINT,
        {
            "stop_on_error": stop_on_error,
            "requests": steps,
        },
        timeout_seconds=timeout_seconds,
    )
    raw_results = data.get("result")
    if not isinstance(raw_results, list):
        raise AppError(
            502,
            "REGOS batch response missing result array",
            "REGOS_BATCH_ERROR",
        )

    by_key: dict[str, dict[str, Any]] = {}
    for step_result in raw_results:
        if not isinstance(step_result, dict):
            continue
        step_key = step_result.get("key")
        if not isinstance(step_key, str) or not step_key:
            continue
        response = _extract_step_response(
            step_result,
            step_key=step_key,
            stop_on_error=stop_on_error,
        )
        if response is not None:
            by_key[step_key] = response

    if stop_on_error:
        missing = [step["key"] for step in steps if step["key"] not in by_key]
        if missing:
            raise AppError(
                502,
                f"REGOS batch response missing steps: {', '.join(missing)}",
                "REGOS_BATCH_ERROR",
            )
    return by_key


async def regos_batch_request_chunks_for_company(
    session: AsyncSession,
    company_id: int,
    steps: list[BatchStep],
    *,
    stop_on_error: bool = False,
    timeout_seconds: int = 120,
) -> dict[str, dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}
    for chunk in chunk_batch_steps(steps):
        merged.update(
            await regos_batch_request_for_company(
                session,
                company_id,
                chunk,
                stop_on_error=stop_on_error,
                timeout_seconds=timeout_seconds,
            )
        )
    return merged
