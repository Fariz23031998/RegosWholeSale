import asyncio
import json
import logging

import aiohttp
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppError
from app.core.regos_rate_limit import (
    MAX_RATE_LIMIT_RETRIES,
    is_regos_rate_limit_error,
    regos_rate_limiter,
)
from app.services.regos_credentials import get_regos_api_auth

logger = logging.getLogger("regos.backend")


async def _post_regos_api(
    *,
    full_url: str,
    headers: dict[str, str],
    request_data: dict | list,
    timeout_seconds: int,
) -> dict:
    timeout = aiohttp.ClientTimeout(total=timeout_seconds)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.post(
            full_url,
            headers=headers,
            data=json.dumps(request_data),
        ) as response:
            if response.status != 200:
                err_msg = f"REGOS API returned status code {response.status}"
                logger.info(err_msg)
                raise AppError(502, err_msg, "REGOS_API_ERROR")

            data = await response.json()
            if not data.get("ok"):
                if is_regos_rate_limit_error(data):
                    return data
                err_result = data.get("result", {})
                error_code = err_result.get("error", "Unknown")
                error_desc = err_result.get("description", "Unknown error")
                err_msg = f"REGOS API error: {error_code} - {error_desc}"
                logger.error(err_msg)
                raise AppError(400, err_msg, "REGOS_API_ERROR")

            result = data.get("result", "There is no result in response")
            if not isinstance(result, (dict, list)):
                raise AppError(
                    502, f"Invalid response from REGOS API: {result}", "REGOS_API_ERROR"
                )
            return data


async def regos_async_api_request(
    endpoint: str,
    request_data: dict | list,
    token: str,
    timeout_seconds: int = 30,
    bearer_token: str | None = None,
) -> dict:
    full_url = f"https://integration.regos.uz/gateway/out/{token}/v1/{endpoint}"
    headers = {"Content-Type": "application/json;charset=utf-8"}
    if bearer_token:
        headers["Authorization"] = f"Bearer {bearer_token}"

    try:
        for attempt in range(MAX_RATE_LIMIT_RETRIES):
            await regos_rate_limiter.acquire(token)
            data = await _post_regos_api(
                full_url=full_url,
                headers=headers,
                request_data=request_data,
                timeout_seconds=timeout_seconds,
            )
            if is_regos_rate_limit_error(data):
                await regos_rate_limiter.mark_exhausted(token)
                if attempt < MAX_RATE_LIMIT_RETRIES - 1:
                    logger.warning(
                        "Regos API rate limit reached (8213) on %s, waiting for refill (attempt %s)",
                        endpoint,
                        attempt + 1,
                    )
                    continue
                err_result = data.get("result", {})
                error_desc = err_result.get("description", "Rate limit exceeded")
                raise AppError(
                    503,
                    f"REGOS API rate limit exceeded: {error_desc}",
                    "REGOS_API_RATE_LIMIT",
                )
            return data

        raise AppError(
            503,
            "REGOS API rate limit retries exhausted",
            "REGOS_API_RATE_LIMIT",
        )

    except asyncio.TimeoutError:
        err_msg = f"REGOS API request timed out after {timeout_seconds} seconds"
        logger.error(err_msg)
        raise AppError(504, err_msg, "REGOS_API_TIMEOUT")
    except AppError:
        raise
    except aiohttp.ClientError as exc:
        err_msg = f"REGOS API client error: {exc}"
        logger.error(err_msg)
        raise AppError(502, err_msg, "REGOS_API_ERROR")
    except Exception as exc:
        err_msg = f"REGOS API error: {exc}"
        logger.error(err_msg)
        raise AppError(502, err_msg, "REGOS_API_ERROR")


async def regos_async_api_request_for_company(
    session: AsyncSession,
    company_id: int,
    endpoint: str,
    request_data: dict | list,
    timeout_seconds: int = 30,
) -> dict:
    auth = await get_regos_api_auth(session, company_id)
    return await regos_async_api_request(
        endpoint=endpoint,
        request_data=request_data,
        token=auth.integration_token,
        timeout_seconds=timeout_seconds,
        bearer_token=auth.bearer_token,
    )
