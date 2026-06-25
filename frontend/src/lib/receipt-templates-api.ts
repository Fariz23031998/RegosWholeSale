import { apiRequest } from "@/lib/api";
import type {
  ReceiptTemplatesPatchRequest,
  ReceiptTemplatesResponse,
} from "@/types/receipt-templates";

const CACHE_TTL_MS = 5 * 60 * 1000;

type CacheEntry = {
  data: ReceiptTemplatesResponse;
  expiresAt: number;
};

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<ReceiptTemplatesResponse>>();

export async function fetchReceiptTemplates(
  token: string,
  options?: { force?: boolean },
): Promise<ReceiptTemplatesResponse> {
  if (!options?.force) {
    const cached = cache.get(token);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    const pending = inflight.get(token);
    if (pending) return pending;
  }

  const request = apiRequest<ReceiptTemplatesResponse>(
    "/api/v1/company/settings/receipt-templates",
    { token },
  )
    .then((data) => {
      cache.set(token, { data, expiresAt: Date.now() + CACHE_TTL_MS });
      inflight.delete(token);
      return data;
    })
    .catch((error) => {
      inflight.delete(token);
      throw error;
    });

  inflight.set(token, request);
  return request;
}

export function invalidateReceiptTemplatesCache(token?: string) {
  if (token) {
    cache.delete(token);
    inflight.delete(token);
    return;
  }
  cache.clear();
  inflight.clear();
}

export async function patchReceiptTemplates(
  token: string,
  body: ReceiptTemplatesPatchRequest,
): Promise<ReceiptTemplatesResponse> {
  const response = await apiRequest<ReceiptTemplatesResponse>(
    "/api/v1/company/settings/receipt-templates",
    {
      method: "PATCH",
      token,
      body,
    },
  );
  invalidateReceiptTemplatesCache(token);
  return response;
}
