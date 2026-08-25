import {
  CATALOG_CACHE_TTL_MS,
  isCacheFresh,
} from "./catalog-products-db";
import {
  fetchPaymentTypes,
  setCachedPaymentTypes,
} from "@/lib/payment-api";
import {
  loadCachedPaymentTypes,
  saveCachedPaymentTypes,
} from "@/lib/payment-types-db";
import type { PaymentTypesResponse } from "@/types/payment";

const inflightLoads = new Map<string, Promise<PaymentTypesResponse>>();

async function revalidatePaymentTypes(token: string, companyId: number): Promise<void> {
  const revalidateKey = `${companyId}:revalidate`;
  if (inflightLoads.has(revalidateKey)) return;

  const request = fetchPaymentTypes(token, { force: true })
    .then(async (response) => {
      await saveCachedPaymentTypes(companyId, response.payment_types).catch(() => undefined);
      return response;
    })
    .finally(() => {
      inflightLoads.delete(revalidateKey);
    });

  inflightLoads.set(revalidateKey, request);
  await request.catch(() => undefined);
}

export async function loadPaymentTypes(
  token: string,
  companyId: number | null | undefined,
  options?: { force?: boolean },
): Promise<PaymentTypesResponse> {
  const companyKey = String(companyId ?? 0);

  if (options?.force) {
    const existing = inflightLoads.get(companyKey);
    if (existing) return existing;

    const request = fetchPaymentTypes(token, { force: true })
      .then(async (response) => {
        await saveCachedPaymentTypes(companyId ?? 0, response.payment_types).catch(() => undefined);
        return response;
      })
      .finally(() => {
        inflightLoads.delete(companyKey);
      });

    inflightLoads.set(companyKey, request);
    return request;
  }

  const cached = await loadCachedPaymentTypes(companyId ?? 0).catch(() => null);
  const hasFreshCache = cached != null && isCacheFresh(cached.fetchedAt, CATALOG_CACHE_TTL_MS);

  if (hasFreshCache) {
    setCachedPaymentTypes(token, { payment_types: cached.payment_types });
    void revalidatePaymentTypes(token, companyId ?? 0);
    return { payment_types: cached.payment_types };
  }

  if (cached != null) {
    setCachedPaymentTypes(token, { payment_types: cached.payment_types });
    void revalidatePaymentTypes(token, companyId ?? 0);
    return { payment_types: cached.payment_types };
  }

  const existing = inflightLoads.get(companyKey);
  if (existing) return existing;

  const request = fetchPaymentTypes(token)
    .then(async (response) => {
      await saveCachedPaymentTypes(companyId ?? 0, response.payment_types).catch(() => undefined);
      return response;
    })
    .finally(() => {
      inflightLoads.delete(companyKey);
    });

  inflightLoads.set(companyKey, request);
  return request;
}
