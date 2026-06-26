import type { ApiErrorBody, ApiValidationError } from "@/types/auth";

function normalizeConfiguredApiBaseUrl(): string {
  const raw = import.meta.env.VITE_API_BASE_URL;
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";
  return trimmed.replace(/\/$/, "");
}

export function getApiBaseUrl(): string {
  const configured = normalizeConfiguredApiBaseUrl();
  if (configured) return configured;
  if (typeof globalThis.location !== "undefined") {
    return globalThis.location.origin;
  }
  return "";
}

function formatValidationError(item: ApiValidationError): string {
  const field = item.loc?.filter((part) => part !== "body").join(".") ?? "";
  return field ? `${field}: ${item.msg}` : item.msg;
}

export function parseApiDetail(detail: ApiErrorBody["detail"]): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail.map(formatValidationError).join("; ");
  }
  return "Request failed";
}

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const DEFAULT_TIMEOUT_MS = 30_000;

type RequestOptions = {
  method?: string;
  body?: unknown;
  token?: string | null;
  timeoutMs?: number;
};

function abortSignalForTimeout(timeoutMs: number): { signal: AbortSignal; clear: () => void } {
  if (typeof AbortSignal.timeout === "function") {
    return { signal: AbortSignal.timeout(timeoutMs), clear: () => {} };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const apiBase = getApiBaseUrl();
  if (!apiBase) {
    throw new ApiError(0, "API URL not configured (set VITE_API_BASE_URL)");
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  const { signal, clear } = abortSignalForTimeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${apiBase}${path}`, {
      method: options.method ?? (options.body !== undefined ? "POST" : "GET"),
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal,
    });
  } catch (err) {
    clear();
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new ApiError(0, "Request timed out. Check your connection and try again.");
    }
    if (err instanceof TypeError) {
      throw new ApiError(0, "Unable to reach the server. Check your connection and try again.");
    }
    throw err;
  } finally {
    clear();
  }

  let data: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { detail: text };
    }
  }

  if (!res.ok) {
    const err = data as ApiErrorBody | null;
    const message = err?.detail ? parseApiDetail(err.detail) : res.statusText;
    throw new ApiError(res.status, message, err?.code);
  }

  return data as T;
}
