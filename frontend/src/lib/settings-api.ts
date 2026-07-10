import { apiRequest } from "@/lib/api";
import {
  invalidateCachedReferenceOptions,
  loadCachedReferenceOptions,
  saveCachedReferenceOptions,
} from "@/lib/reference-options-db";
import {
  buildCompanySettingsKey,
  buildEmployeeSettingsKey,
  loadCachedSettingsData,
  saveCachedSettings,
  type SettingsCacheScope,
} from "@/lib/settings-db";
import { fetchReceiptTemplates } from "@/lib/receipt-templates-api";
import type {
  ExchangeRateFormulaPreviewRequest,
  ExchangeRateFormulaPreviewResponse,
  ExchangeRateSyncPatchRequest,
  ExchangeRateSyncResponse,
  ExchangeRateSyncRunResponse,
  PosSettingsPatchRequest,
  PosSettingsResponse,
  RegosDefaultsPatchRequest,
  RegosDefaultsResponse,
  RegosDocPaymentSaleIdFieldResponse,
  RegosPaymentLinkingPatchRequest,
  RegosPaymentLinkingResponse,
  RegosReferenceOptionsResponse,
  RegosTokenConfig,
  RegosTokenMessage,
  RegosTokenUpsertRequest,
  UserPosSettingsPatchRequest,
  UserPosSettingsResponse,
} from "@/types/settings";

export const SETTINGS_QUERY_KEYS = {
  pos: (token: string | null) => ["settings", "pos", token] as const,
  regosBootstrap: (token: string | null) => ["settings", "regos-bootstrap", token] as const,
  receiptTemplates: (token: string | null) => ["settings", "receipt-templates", token] as const,
  exchangeRateSync: (token: string | null) => ["settings", "exchange-rate-sync", token] as const,
};

export type { SettingsCacheScope } from "@/lib/settings-db";

type FetchOptions = {
  force?: boolean;
  cacheScope?: SettingsCacheScope;
};

const REGOS_DEFAULTS_CACHE_TTL_MS = 5 * 60 * 1000;
const SETTINGS_CACHE_TTL_MS = 5 * 60 * 1000;

type CacheEntry<T> = {
  data: T;
  expiresAt: number;
};

async function saveSettingsToIdb(key: string | null, data: unknown): Promise<void> {
  if (!key) return;
  await saveCachedSettings(key, data).catch(() => undefined);
}

async function loadSettingsFromIdb<T>(key: string | null): Promise<T | null> {
  if (!key) return null;
  return loadCachedSettingsData<T>(key);
}

type RegosDefaultsCacheEntry = CacheEntry<RegosDefaultsResponse>;
const regosDefaultsCache = new Map<string, RegosDefaultsCacheEntry>();
const regosDefaultsInflight = new Map<string, Promise<RegosDefaultsResponse>>();

type RegosReferenceOptionsCacheEntry = CacheEntry<RegosReferenceOptionsResponse>;
const regosReferenceOptionsCache = new Map<string, RegosReferenceOptionsCacheEntry>();
const regosReferenceOptionsInflight = new Map<string, Promise<RegosReferenceOptionsResponse>>();

type MyRegosDefaultsCacheEntry = CacheEntry<RegosDefaultsResponse>;
const myRegosDefaultsCache = new Map<string, MyRegosDefaultsCacheEntry>();
const myRegosDefaultsInflight = new Map<string, Promise<RegosDefaultsResponse>>();

type UserPosSettingsCacheEntry = CacheEntry<UserPosSettingsResponse>;
const userPosSettingsCache = new Map<string, UserPosSettingsCacheEntry>();
const userPosSettingsInflight = new Map<string, Promise<UserPosSettingsResponse>>();

type PosSettingsCacheEntry = CacheEntry<PosSettingsResponse>;
const posSettingsCache = new Map<string, PosSettingsCacheEntry>();
const posSettingsInflight = new Map<string, Promise<PosSettingsResponse>>();

type RegosTokenCacheEntry = CacheEntry<RegosTokenConfig>;
const regosTokenCache = new Map<string, RegosTokenCacheEntry>();
const regosTokenInflight = new Map<string, Promise<RegosTokenConfig>>();

type PaymentLinkingCacheEntry = CacheEntry<RegosPaymentLinkingResponse>;
const paymentLinkingCache = new Map<string, PaymentLinkingCacheEntry>();
const paymentLinkingInflight = new Map<string, Promise<RegosPaymentLinkingResponse>>();

type DocPaymentSaleIdCacheEntry = CacheEntry<RegosDocPaymentSaleIdFieldResponse>;
const docPaymentSaleIdCache = new Map<string, DocPaymentSaleIdCacheEntry>();
const docPaymentSaleIdInflight = new Map<string, Promise<RegosDocPaymentSaleIdFieldResponse>>();

type ExchangeRateSyncCacheEntry = CacheEntry<ExchangeRateSyncResponse>;
const exchangeRateSyncCache = new Map<string, ExchangeRateSyncCacheEntry>();
const exchangeRateSyncInflight = new Map<string, Promise<ExchangeRateSyncResponse>>();

function companyKey(scope: SettingsCacheScope | undefined, namespace: Parameters<typeof buildCompanySettingsKey>[1]) {
  if (!scope?.companyId) return null;
  return buildCompanySettingsKey(scope.companyId, namespace);
}

function employeeKey(
  scope: SettingsCacheScope | undefined,
  namespace: "pos" | "regos-defaults",
) {
  if (!scope?.companyId || !scope.userId) return null;
  return buildEmployeeSettingsKey(scope.companyId, scope.userId, namespace);
}

export async function prefetchSettingsFromIdb<T>(
  key: string | null,
): Promise<T | undefined> {
  if (!key) return undefined;
  const data = await loadSettingsFromIdb<T>(key);
  return data ?? undefined;
}

export async function fetchPosSettings(
  token: string,
  options?: FetchOptions,
): Promise<PosSettingsResponse> {
  const idbKey = companyKey(options?.cacheScope, "pos");

  if (!options?.force) {
    const cached = posSettingsCache.get(token);
    if (cached && cached.expiresAt > Date.now()) return cached.data;

    const pending = posSettingsInflight.get(token);
    if (pending) return pending;

    const idb = await loadSettingsFromIdb<PosSettingsResponse>(idbKey);
    if (idb) return idb;
  }

  const request = apiRequest<PosSettingsResponse>("/api/v1/company/settings/pos", { token })
    .then(async (data) => {
      posSettingsCache.set(token, { data, expiresAt: Date.now() + SETTINGS_CACHE_TTL_MS });
      posSettingsInflight.delete(token);
      await saveSettingsToIdb(idbKey, data);
      return data;
    })
    .catch(async (error) => {
      posSettingsInflight.delete(token);
      const idb = await loadSettingsFromIdb<PosSettingsResponse>(idbKey);
      if (idb) return idb;
      throw error;
    });

  posSettingsInflight.set(token, request);
  return request;
}

export async function patchPosSettings(
  token: string,
  body: PosSettingsPatchRequest,
  cacheScope?: SettingsCacheScope,
): Promise<PosSettingsResponse> {
  const response = await apiRequest<PosSettingsResponse>("/api/v1/company/settings/pos", {
    method: "PATCH",
    token,
    body,
  });
  posSettingsCache.set(token, { data: response, expiresAt: Date.now() + SETTINGS_CACHE_TTL_MS });
  await saveSettingsToIdb(companyKey(cacheScope, "pos"), response);
  return response;
}

export async function fetchRegosTokenConfig(
  token: string,
  options?: FetchOptions,
): Promise<RegosTokenConfig> {
  const idbKey = companyKey(options?.cacheScope, "regos-token");

  if (!options?.force) {
    const cached = regosTokenCache.get(token);
    if (cached && cached.expiresAt > Date.now()) return cached.data;

    const pending = regosTokenInflight.get(token);
    if (pending) return pending;

    const idb = await loadSettingsFromIdb<RegosTokenConfig>(idbKey);
    if (idb) return idb;
  }

  const request = apiRequest<RegosTokenConfig>("/api/v1/regos/tokens", { token })
    .then(async (data) => {
      regosTokenCache.set(token, { data, expiresAt: Date.now() + SETTINGS_CACHE_TTL_MS });
      regosTokenInflight.delete(token);
      await saveSettingsToIdb(idbKey, data);
      return data;
    })
    .catch(async (error) => {
      regosTokenInflight.delete(token);
      const idb = await loadSettingsFromIdb<RegosTokenConfig>(idbKey);
      if (idb) return idb;
      throw error;
    });

  regosTokenInflight.set(token, request);
  return request;
}

export async function saveRegosToken(
  token: string,
  body: RegosTokenUpsertRequest,
  cacheScope?: SettingsCacheScope,
): Promise<RegosTokenMessage> {
  const response = await apiRequest<RegosTokenMessage>("/api/v1/regos/tokens", {
    method: "PUT",
    token,
    body,
  });
  regosTokenCache.delete(token);
  return response;
}

export async function deleteRegosToken(
  token: string,
  cacheScope?: SettingsCacheScope,
): Promise<RegosTokenMessage> {
  const response = await apiRequest<RegosTokenMessage>("/api/v1/regos/tokens", {
    method: "DELETE",
    token,
  });
  regosTokenCache.delete(token);
  return response;
}

export async function updateRegosIntegration(
  token: string,
  cacheScope?: SettingsCacheScope,
): Promise<RegosTokenMessage> {
  const response = await apiRequest<RegosTokenMessage>("/api/v1/regos/tokens/update-integration", {
    method: "POST",
    token,
  });
  regosTokenCache.delete(token);
  return response;
}

export async function fetchRegosDefaults(
  token: string,
  options?: FetchOptions,
): Promise<RegosDefaultsResponse> {
  const idbKey = companyKey(options?.cacheScope, "regos-defaults");

  if (!options?.force) {
    const cached = regosDefaultsCache.get(token);
    if (cached && cached.expiresAt > Date.now()) return cached.data;

    const pending = regosDefaultsInflight.get(token);
    if (pending) return pending;

    const idb = await loadSettingsFromIdb<RegosDefaultsResponse>(idbKey);
    if (idb) return idb;
  }

  const request = apiRequest<RegosDefaultsResponse>("/api/v1/company/settings/regos-defaults", {
    token,
  })
    .then(async (data) => {
      regosDefaultsCache.set(token, {
        data,
        expiresAt: Date.now() + REGOS_DEFAULTS_CACHE_TTL_MS,
      });
      regosDefaultsInflight.delete(token);
      await saveSettingsToIdb(idbKey, data);
      return data;
    })
    .catch(async (error) => {
      regosDefaultsInflight.delete(token);
      const idb = await loadSettingsFromIdb<RegosDefaultsResponse>(idbKey);
      if (idb) return idb;
      throw error;
    });

  regosDefaultsInflight.set(token, request);
  return request;
}

export function invalidateRegosDefaultsCache(token?: string) {
  if (token) {
    regosDefaultsCache.delete(token);
    regosDefaultsInflight.delete(token);
    return;
  }
  regosDefaultsCache.clear();
  regosDefaultsInflight.clear();
}

export async function patchRegosDefaults(
  token: string,
  body: RegosDefaultsPatchRequest,
  cacheScope?: SettingsCacheScope,
): Promise<RegosDefaultsResponse> {
  const response = await apiRequest<RegosDefaultsResponse>("/api/v1/company/settings/regos-defaults", {
    method: "PATCH",
    token,
    body,
  });
  invalidateRegosDefaultsCache(token);
  await saveSettingsToIdb(companyKey(cacheScope, "regos-defaults"), response);
  return response;
}

export async function fetchRegosReferenceOptions(
  token: string,
  options?: FetchOptions,
): Promise<RegosReferenceOptionsResponse> {
  const companyId = options?.cacheScope?.companyId;

  if (!options?.force) {
    const cached = regosReferenceOptionsCache.get(token);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    const pending = regosReferenceOptionsInflight.get(token);
    if (pending) return pending;

    if (companyId != null) {
      const idb = await loadCachedReferenceOptions(companyId).catch(() => null);
      if (idb) {
        const fromIdb = referenceOptionsFromIdb(idb, cached?.data);
        regosReferenceOptionsCache.set(token, {
          data: fromIdb,
          expiresAt: Date.now() + SETTINGS_CACHE_TTL_MS,
        });
        void fetchRegosReferenceOptions(token, {
          force: true,
          cacheScope: options?.cacheScope,
        }).catch(() => undefined);
        return fromIdb;
      }
    }
  }

  const request = apiRequest<RegosReferenceOptionsResponse>("/api/v1/regos/reference-options", {
    token,
  })
    .then(async (data) => {
      regosReferenceOptionsCache.set(token, {
        data,
        expiresAt: Date.now() + SETTINGS_CACHE_TTL_MS,
      });
      regosReferenceOptionsInflight.delete(token);
      if (companyId != null) {
        await saveCachedReferenceOptions(companyId, {
          warehouses: data.warehouses,
          price_types: data.price_types,
          partners: data.partners,
        }).catch(() => undefined);
      }
      return data;
    })
    .catch(async (error) => {
      regosReferenceOptionsInflight.delete(token);
      if (companyId != null) {
        const idb = await loadCachedReferenceOptions(companyId).catch(() => null);
        if (idb) {
          return referenceOptionsFromIdb(idb, regosReferenceOptionsCache.get(token)?.data);
        }
      }
      throw error;
    });

  regosReferenceOptionsInflight.set(token, request);
  return request;
}

function referenceOptionsFromIdb(
  cached: {
    warehouses: RegosReferenceOptionsResponse["warehouses"];
    price_types: RegosReferenceOptionsResponse["price_types"];
    partners: RegosReferenceOptionsResponse["partners"];
  },
  existing?: RegosReferenceOptionsResponse,
): RegosReferenceOptionsResponse {
  return {
    warehouses: cached.warehouses,
    price_types: cached.price_types,
    partners: cached.partners,
    payment_categories: existing?.payment_categories ?? [],
    refund_payment_categories: existing?.refund_payment_categories ?? [],
    attached_users: existing?.attached_users ?? [],
    firms: existing?.firms ?? [],
  };
}

export function patchReferenceOptionsInMemory(
  token: string,
  partial: Partial<
    Pick<RegosReferenceOptionsResponse, "warehouses" | "price_types" | "partners">
  >,
): void {
  const cached = regosReferenceOptionsCache.get(token);
  if (!cached) return;
  cached.data = { ...cached.data, ...partial };
}

export async function invalidateRegosReferenceOptionsCache(
  token?: string,
  companyId?: number,
): Promise<void> {
  if (token) {
    regosReferenceOptionsCache.delete(token);
    regosReferenceOptionsInflight.delete(token);
  } else {
    regosReferenceOptionsCache.clear();
    regosReferenceOptionsInflight.clear();
  }
  if (companyId != null) {
    await invalidateCachedReferenceOptions(companyId).catch(() => undefined);
  }
}

export async function fetchDocPaymentSaleIdField(
  token: string,
  options?: FetchOptions,
): Promise<RegosDocPaymentSaleIdFieldResponse> {
  const idbKey = companyKey(options?.cacheScope, "doc-payment-sale-id");

  if (!options?.force) {
    const cached = docPaymentSaleIdCache.get(token);
    if (cached && cached.expiresAt > Date.now()) return cached.data;

    const pending = docPaymentSaleIdInflight.get(token);
    if (pending) return pending;

    const idb = await loadSettingsFromIdb<RegosDocPaymentSaleIdFieldResponse>(idbKey);
    if (idb) return idb;
  }

  const request = apiRequest<RegosDocPaymentSaleIdFieldResponse>(
    "/api/v1/regos/fields/doc-payment-sale-id",
    { token },
  )
    .then(async (data) => {
      docPaymentSaleIdCache.set(token, { data, expiresAt: Date.now() + SETTINGS_CACHE_TTL_MS });
      docPaymentSaleIdInflight.delete(token);
      await saveSettingsToIdb(idbKey, data);
      return data;
    })
    .catch(async (error) => {
      docPaymentSaleIdInflight.delete(token);
      const idb = await loadSettingsFromIdb<RegosDocPaymentSaleIdFieldResponse>(idbKey);
      if (idb) return idb;
      throw error;
    });

  docPaymentSaleIdInflight.set(token, request);
  return request;
}

export async function createDocPaymentSaleIdField(
  token: string,
  cacheScope?: SettingsCacheScope,
): Promise<RegosDocPaymentSaleIdFieldResponse> {
  const response = await apiRequest<RegosDocPaymentSaleIdFieldResponse>(
    "/api/v1/regos/fields/doc-payment-sale-id",
    {
      method: "POST",
      token,
    },
  );
  docPaymentSaleIdCache.delete(token);
  await saveSettingsToIdb(companyKey(cacheScope, "doc-payment-sale-id"), response);
  return response;
}

export async function fetchPaymentLinking(
  token: string,
  options?: FetchOptions,
): Promise<RegosPaymentLinkingResponse> {
  const idbKey = companyKey(options?.cacheScope, "payment-linking");

  if (!options?.force) {
    const cached = paymentLinkingCache.get(token);
    if (cached && cached.expiresAt > Date.now()) return cached.data;

    const pending = paymentLinkingInflight.get(token);
    if (pending) return pending;

    const idb = await loadSettingsFromIdb<RegosPaymentLinkingResponse>(idbKey);
    if (idb) return idb;
  }

  const request = apiRequest<RegosPaymentLinkingResponse>("/api/v1/regos/payment-linking", { token })
    .then(async (data) => {
      paymentLinkingCache.set(token, { data, expiresAt: Date.now() + SETTINGS_CACHE_TTL_MS });
      paymentLinkingInflight.delete(token);
      await saveSettingsToIdb(idbKey, data);
      return data;
    })
    .catch(async (error) => {
      paymentLinkingInflight.delete(token);
      const idb = await loadSettingsFromIdb<RegosPaymentLinkingResponse>(idbKey);
      if (idb) return idb;
      throw error;
    });

  paymentLinkingInflight.set(token, request);
  return request;
}

export async function patchPaymentLinking(
  token: string,
  body: RegosPaymentLinkingPatchRequest,
  cacheScope?: SettingsCacheScope,
): Promise<RegosPaymentLinkingResponse> {
  const response = await apiRequest<RegosPaymentLinkingResponse>("/api/v1/regos/payment-linking", {
    method: "PATCH",
    token,
    body,
  });
  paymentLinkingCache.set(token, { data: response, expiresAt: Date.now() + SETTINGS_CACHE_TTL_MS });
  await saveSettingsToIdb(companyKey(cacheScope, "payment-linking"), response);
  return response;
}

export async function fetchMyRegosDefaults(
  token: string,
  options?: FetchOptions,
): Promise<RegosDefaultsResponse> {
  const idbKey = employeeKey(options?.cacheScope, "regos-defaults");

  if (!options?.force) {
    const cached = myRegosDefaultsCache.get(token);
    if (cached && cached.expiresAt > Date.now()) return cached.data;

    const pending = myRegosDefaultsInflight.get(token);
    if (pending) return pending;

    const idb = await loadSettingsFromIdb<RegosDefaultsResponse>(idbKey);
    if (idb) return idb;
  }

  const request = apiRequest<RegosDefaultsResponse>("/api/v1/me/settings/regos-defaults", { token })
    .then(async (data) => {
      myRegosDefaultsCache.set(token, {
        data,
        expiresAt: Date.now() + SETTINGS_CACHE_TTL_MS,
      });
      myRegosDefaultsInflight.delete(token);
      await saveSettingsToIdb(idbKey, data);
      return data;
    })
    .catch(async (error) => {
      myRegosDefaultsInflight.delete(token);
      const idb = await loadSettingsFromIdb<RegosDefaultsResponse>(idbKey);
      if (idb) return idb;
      throw error;
    });

  myRegosDefaultsInflight.set(token, request);
  return request;
}

export function invalidateMyRegosDefaultsCache(token?: string) {
  if (token) {
    myRegosDefaultsCache.delete(token);
    myRegosDefaultsInflight.delete(token);
    return;
  }
  myRegosDefaultsCache.clear();
  myRegosDefaultsInflight.clear();
}

export async function fetchUserPosSettings(
  token: string,
  options?: FetchOptions,
): Promise<UserPosSettingsResponse> {
  const idbKey = employeeKey(options?.cacheScope, "pos");

  if (!options?.force) {
    const cached = userPosSettingsCache.get(token);
    if (cached && cached.expiresAt > Date.now()) return cached.data;

    const pending = userPosSettingsInflight.get(token);
    if (pending) return pending;

    const idb = await loadSettingsFromIdb<UserPosSettingsResponse>(idbKey);
    if (idb) return idb;
  }

  const request = apiRequest<UserPosSettingsResponse>("/api/v1/me/settings/pos", { token })
    .then(async (data) => {
      userPosSettingsCache.set(token, {
        data,
        expiresAt: Date.now() + SETTINGS_CACHE_TTL_MS,
      });
      userPosSettingsInflight.delete(token);
      await saveSettingsToIdb(idbKey, data);
      return data;
    })
    .catch(async (error) => {
      userPosSettingsInflight.delete(token);
      const idb = await loadSettingsFromIdb<UserPosSettingsResponse>(idbKey);
      if (idb) return idb;
      throw error;
    });

  userPosSettingsInflight.set(token, request);
  return request;
}

export function invalidateUserPosSettingsCache(token?: string) {
  if (token) {
    userPosSettingsCache.delete(token);
    userPosSettingsInflight.delete(token);
    return;
  }
  userPosSettingsCache.clear();
  userPosSettingsInflight.clear();
}

export async function patchUserPosSettings(
  token: string,
  body: UserPosSettingsPatchRequest,
  cacheScope?: SettingsCacheScope,
): Promise<UserPosSettingsResponse> {
  const response = await apiRequest<UserPosSettingsResponse>("/api/v1/me/settings/pos", {
    method: "PATCH",
    token,
    body,
  });
  invalidateUserPosSettingsCache(token);
  await saveSettingsToIdb(employeeKey(cacheScope, "pos"), response);
  return response;
}

export async function fetchExchangeRateSync(
  token: string,
  options?: FetchOptions,
): Promise<ExchangeRateSyncResponse> {
  const idbKey = companyKey(options?.cacheScope, "exchange-rate-sync");

  if (!options?.force) {
    const cached = exchangeRateSyncCache.get(token);
    if (cached && cached.expiresAt > Date.now()) return cached.data;

    const pending = exchangeRateSyncInflight.get(token);
    if (pending) return pending;

    const idb = await loadSettingsFromIdb<ExchangeRateSyncResponse>(idbKey);
    if (idb) return idb;
  }

  const request = apiRequest<ExchangeRateSyncResponse>(
    "/api/v1/company/settings/exchange-rate-sync",
    { token },
  )
    .then(async (data) => {
      exchangeRateSyncCache.set(token, { data, expiresAt: Date.now() + SETTINGS_CACHE_TTL_MS });
      exchangeRateSyncInflight.delete(token);
      await saveSettingsToIdb(idbKey, data);
      return data;
    })
    .catch(async (error) => {
      exchangeRateSyncInflight.delete(token);
      const idb = await loadSettingsFromIdb<ExchangeRateSyncResponse>(idbKey);
      if (idb) return idb;
      throw error;
    });

  exchangeRateSyncInflight.set(token, request);
  return request;
}

export async function patchExchangeRateSync(
  token: string,
  body: ExchangeRateSyncPatchRequest,
  cacheScope?: SettingsCacheScope,
): Promise<ExchangeRateSyncResponse> {
  const response = await apiRequest<ExchangeRateSyncResponse>(
    "/api/v1/company/settings/exchange-rate-sync",
    {
      method: "PATCH",
      token,
      body,
    },
  );
  exchangeRateSyncCache.set(token, { data: response, expiresAt: Date.now() + SETTINGS_CACHE_TTL_MS });
  await saveSettingsToIdb(companyKey(cacheScope, "exchange-rate-sync"), response);
  return response;
}

export async function runExchangeRateSync(token: string): Promise<ExchangeRateSyncRunResponse> {
  return apiRequest("/api/v1/company/settings/exchange-rate-sync/run", {
    method: "POST",
    token,
  });
}

export async function previewExchangeRateFormula(
  token: string,
  body: ExchangeRateFormulaPreviewRequest,
): Promise<ExchangeRateFormulaPreviewResponse> {
  return apiRequest("/api/v1/company/settings/exchange-rate-sync/preview", {
    method: "POST",
    token,
    body,
  });
}

export async function refreshSettingsNamespace(
  token: string,
  namespace:
    | "pos"
    | "regos_defaults"
    | "receipt_templates"
    | "exchange_rate_sync"
    | "regos_token"
    | "payment_linking"
    | "doc_payment_sale_id",
  cacheScope: SettingsCacheScope,
): Promise<void> {
  switch (namespace) {
    case "pos":
      if (cacheScope.userId) {
        await fetchUserPosSettings(token, { force: true, cacheScope });
      }
      await fetchPosSettings(token, { force: true, cacheScope });
      return;
    case "regos_defaults":
      if (cacheScope.userId) {
        await fetchMyRegosDefaults(token, { force: true, cacheScope });
      }
      await fetchRegosDefaults(token, { force: true, cacheScope });
      return;
    case "receipt_templates":
      await fetchReceiptTemplates(token, { force: true, cacheScope });
      return;
    case "exchange_rate_sync":
      await fetchExchangeRateSync(token, { force: true, cacheScope });
      return;
    case "regos_token":
      await fetchRegosTokenConfig(token, { force: true, cacheScope });
      return;
    case "payment_linking":
      await fetchPaymentLinking(token, { force: true, cacheScope });
      return;
    case "doc_payment_sale_id":
      await fetchDocPaymentSaleIdField(token, { force: true, cacheScope });
      return;
    default:
      return;
  }
}
