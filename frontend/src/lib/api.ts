import type { ApiErrorBody, ApiValidationError } from "@/types/auth";

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ?? "";

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

export function getApiBaseUrl(): string {
  return API_BASE;
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  token?: string | null;
};

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  if (!API_BASE) {
    throw new ApiError(0, "API URL not configured (set VITE_API_BASE_URL)");
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? (options.body !== undefined ? "POST" : "GET"),
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

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
