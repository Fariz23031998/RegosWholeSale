import { apiRequest } from "@/lib/api";
import type { PaymentType, PaymentTypesResponse } from "@/types/payment";

const CACHE_TTL_MS = 5 * 60 * 1000;

type CacheEntry = {
  data: PaymentTypesResponse;
  expiresAt: number;
};

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<PaymentTypesResponse>>();

export function getCachedPaymentTypes(token: string): PaymentTypesResponse | null {
  const cached = cache.get(token);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }
  return null;
}

export function setCachedPaymentTypes(token: string, data: PaymentTypesResponse): void {
  cache.set(token, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

export function patchPaymentTypesInMemory(token: string, paymentTypes: PaymentType[]): void {
  setCachedPaymentTypes(token, { payment_types: paymentTypes });
}

export function removePaymentTypesFromMemory(token: string, ids: number[]): void {
  const cached = cache.get(token);
  if (!cached) return;
  const idSet = new Set(ids);
  const paymentTypes = cached.data.payment_types.filter((type) => !idSet.has(type.id));
  setCachedPaymentTypes(token, { payment_types: paymentTypes });
}

export async function fetchPaymentTypes(
  token: string,
  options?: { force?: boolean },
): Promise<PaymentTypesResponse> {
  if (!options?.force) {
    const cached = getCachedPaymentTypes(token);
    if (cached) return cached;

    const pending = inflight.get(token);
    if (pending) return pending;
  }

  const request = apiRequest<PaymentTypesResponse>("/api/v1/regos/payment-types", { token })
    .then((data) => {
      setCachedPaymentTypes(token, data);
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
