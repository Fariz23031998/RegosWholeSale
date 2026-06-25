import { apiRequest } from "@/lib/api";
import type { PaymentTypesResponse } from "@/types/payment";

const CACHE_TTL_MS = 5 * 60 * 1000;

type CacheEntry = {
  data: PaymentTypesResponse;
  expiresAt: number;
};

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<PaymentTypesResponse>>();

export async function fetchPaymentTypes(
  token: string,
  options?: { force?: boolean },
): Promise<PaymentTypesResponse> {
  if (!options?.force) {
    const cached = cache.get(token);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    const pending = inflight.get(token);
    if (pending) return pending;
  }

  const request = apiRequest<PaymentTypesResponse>("/api/v1/regos/payment-types", { token })
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

export function invalidatePaymentTypesCache(token?: string) {
  if (token) {
    cache.delete(token);
    inflight.delete(token);
    return;
  }
  cache.clear();
  inflight.clear();
}
