import { apiRequest } from "@/lib/api";
import {
  buildCompanySettingsKey,
  loadCachedSettingsData,
  saveCachedSettings,
  type SettingsCacheScope,
} from "@/lib/settings-db";
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

async function saveToIdb(key: string | null, data: ReceiptTemplatesResponse): Promise<void> {
  if (!key) return;
  await saveCachedSettings(key, data).catch(() => undefined);
}

function idbKey(cacheScope?: SettingsCacheScope): string | null {
  if (!cacheScope?.companyId) return null;
  return buildCompanySettingsKey(cacheScope.companyId, "receipt-templates");
}

export async function fetchReceiptTemplates(
  token: string,
  options?: { force?: boolean; cacheScope?: SettingsCacheScope },
): Promise<ReceiptTemplatesResponse> {
  const storageKey = idbKey(options?.cacheScope);

  if (!options?.force) {
    const cached = cache.get(token);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    const pending = inflight.get(token);
    if (pending) return pending;

    const idb = await loadCachedSettingsData<ReceiptTemplatesResponse>(storageKey);
    if (idb) return idb;
  }

  const request = apiRequest<ReceiptTemplatesResponse>(
    "/api/v1/company/settings/receipt-templates",
    { token },
  )
    .then(async (data) => {
      cache.set(token, { data, expiresAt: Date.now() + CACHE_TTL_MS });
      inflight.delete(token);
      await saveToIdb(storageKey, data);
      return data;
    })
    .catch(async (error) => {
      inflight.delete(token);
      const idb = await loadCachedSettingsData<ReceiptTemplatesResponse>(storageKey);
      if (idb) return idb;
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
  cacheScope?: SettingsCacheScope,
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
  await saveToIdb(idbKey(cacheScope), response);
  return response;
}
