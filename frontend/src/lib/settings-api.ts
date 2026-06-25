import { apiRequest } from "@/lib/api";
import type {
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

export async function fetchPosSettings(token: string): Promise<PosSettingsResponse> {
  return apiRequest("/api/v1/company/settings/pos", { token });
}

export async function patchPosSettings(
  token: string,
  body: PosSettingsPatchRequest,
): Promise<PosSettingsResponse> {
  return apiRequest("/api/v1/company/settings/pos", {
    method: "PATCH",
    token,
    body,
  });
}

export async function fetchRegosTokenConfig(token: string): Promise<RegosTokenConfig> {
  return apiRequest("/api/v1/regos/tokens", { token });
}

export async function saveRegosToken(
  token: string,
  body: RegosTokenUpsertRequest,
): Promise<RegosTokenMessage> {
  return apiRequest("/api/v1/regos/tokens", {
    method: "PUT",
    token,
    body,
  });
}

export async function deleteRegosToken(token: string): Promise<RegosTokenMessage> {
  return apiRequest("/api/v1/regos/tokens", {
    method: "DELETE",
    token,
  });
}

const REGOS_DEFAULTS_CACHE_TTL_MS = 5 * 60 * 1000;
const SETTINGS_CACHE_TTL_MS = 5 * 60 * 1000;

type RegosDefaultsCacheEntry = {
  data: RegosDefaultsResponse;
  expiresAt: number;
};

const regosDefaultsCache = new Map<string, RegosDefaultsCacheEntry>();
const regosDefaultsInflight = new Map<string, Promise<RegosDefaultsResponse>>();

type RegosReferenceOptionsCacheEntry = {
  data: RegosReferenceOptionsResponse;
  expiresAt: number;
};

const regosReferenceOptionsCache = new Map<string, RegosReferenceOptionsCacheEntry>();
const regosReferenceOptionsInflight = new Map<string, Promise<RegosReferenceOptionsResponse>>();

type MyRegosDefaultsCacheEntry = {
  data: RegosDefaultsResponse;
  expiresAt: number;
};

const myRegosDefaultsCache = new Map<string, MyRegosDefaultsCacheEntry>();
const myRegosDefaultsInflight = new Map<string, Promise<RegosDefaultsResponse>>();

type UserPosSettingsCacheEntry = {
  data: UserPosSettingsResponse;
  expiresAt: number;
};

const userPosSettingsCache = new Map<string, UserPosSettingsCacheEntry>();
const userPosSettingsInflight = new Map<string, Promise<UserPosSettingsResponse>>();

export async function fetchRegosDefaults(
  token: string,
  options?: { force?: boolean },
): Promise<RegosDefaultsResponse> {
  if (!options?.force) {
    const cached = regosDefaultsCache.get(token);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    const pending = regosDefaultsInflight.get(token);
    if (pending) return pending;
  }

  const request = apiRequest<RegosDefaultsResponse>("/api/v1/company/settings/regos-defaults", {
    token,
  })
    .then((data) => {
      regosDefaultsCache.set(token, {
        data,
        expiresAt: Date.now() + REGOS_DEFAULTS_CACHE_TTL_MS,
      });
      regosDefaultsInflight.delete(token);
      return data;
    })
    .catch((error) => {
      regosDefaultsInflight.delete(token);
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
): Promise<RegosDefaultsResponse> {
  const response = await apiRequest<RegosDefaultsResponse>("/api/v1/company/settings/regos-defaults", {
    method: "PATCH",
    token,
    body,
  });
  invalidateRegosDefaultsCache(token);
  return response;
}

export async function fetchRegosReferenceOptions(
  token: string,
  options?: { force?: boolean },
): Promise<RegosReferenceOptionsResponse> {
  if (!options?.force) {
    const cached = regosReferenceOptionsCache.get(token);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    const pending = regosReferenceOptionsInflight.get(token);
    if (pending) return pending;
  }

  const request = apiRequest<RegosReferenceOptionsResponse>("/api/v1/regos/reference-options", {
    token,
  })
    .then((data) => {
      regosReferenceOptionsCache.set(token, {
        data,
        expiresAt: Date.now() + SETTINGS_CACHE_TTL_MS,
      });
      regosReferenceOptionsInflight.delete(token);
      return data;
    })
    .catch((error) => {
      regosReferenceOptionsInflight.delete(token);
      throw error;
    });

  regosReferenceOptionsInflight.set(token, request);
  return request;
}

export function invalidateRegosReferenceOptionsCache(token?: string) {
  if (token) {
    regosReferenceOptionsCache.delete(token);
    regosReferenceOptionsInflight.delete(token);
    return;
  }
  regosReferenceOptionsCache.clear();
  regosReferenceOptionsInflight.clear();
}

export async function fetchDocPaymentSaleIdField(
  token: string,
): Promise<RegosDocPaymentSaleIdFieldResponse> {
  return apiRequest("/api/v1/regos/fields/doc-payment-sale-id", { token });
}

export async function createDocPaymentSaleIdField(
  token: string,
): Promise<RegosDocPaymentSaleIdFieldResponse> {
  return apiRequest("/api/v1/regos/fields/doc-payment-sale-id", {
    method: "POST",
    token,
  });
}

export async function fetchPaymentLinking(
  token: string,
): Promise<RegosPaymentLinkingResponse> {
  return apiRequest("/api/v1/regos/payment-linking", { token });
}

export async function patchPaymentLinking(
  token: string,
  body: RegosPaymentLinkingPatchRequest,
): Promise<RegosPaymentLinkingResponse> {
  return apiRequest("/api/v1/regos/payment-linking", {
    method: "PATCH",
    token,
    body,
  });
}

export async function fetchMyRegosDefaults(
  token: string,
  options?: { force?: boolean },
): Promise<RegosDefaultsResponse> {
  if (!options?.force) {
    const cached = myRegosDefaultsCache.get(token);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    const pending = myRegosDefaultsInflight.get(token);
    if (pending) return pending;
  }

  const request = apiRequest<RegosDefaultsResponse>("/api/v1/me/settings/regos-defaults", { token })
    .then((data) => {
      myRegosDefaultsCache.set(token, {
        data,
        expiresAt: Date.now() + SETTINGS_CACHE_TTL_MS,
      });
      myRegosDefaultsInflight.delete(token);
      return data;
    })
    .catch((error) => {
      myRegosDefaultsInflight.delete(token);
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
  options?: { force?: boolean },
): Promise<UserPosSettingsResponse> {
  if (!options?.force) {
    const cached = userPosSettingsCache.get(token);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    const pending = userPosSettingsInflight.get(token);
    if (pending) return pending;
  }

  const request = apiRequest<UserPosSettingsResponse>("/api/v1/me/settings/pos", { token })
    .then((data) => {
      userPosSettingsCache.set(token, {
        data,
        expiresAt: Date.now() + SETTINGS_CACHE_TTL_MS,
      });
      userPosSettingsInflight.delete(token);
      return data;
    })
    .catch((error) => {
      userPosSettingsInflight.delete(token);
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
): Promise<UserPosSettingsResponse> {
  const response = await apiRequest<UserPosSettingsResponse>("/api/v1/me/settings/pos", {
    method: "PATCH",
    token,
    body,
  });
  invalidateUserPosSettingsCache(token);
  return response;
}
