import { apiRequest } from "@/lib/api";
import type {
  FirmsListResponse,
  Partner,
  PartnerBalanceMode,
  PartnerBalanceResponse,
  PartnerCreateRequest,
  PartnerGroupsResponse,
  PartnerUpdateRequest,
  PartnersListResponse,
} from "@/types/partners";

type PartnersQuery = {
  offset?: number;
  limit?: number;
  search?: string;
};

export async function fetchPartners(
  token: string,
  query: PartnersQuery = {},
): Promise<PartnersListResponse> {
  const params = new URLSearchParams();
  params.set("offset", String(query.offset ?? 0));
  params.set("limit", String(query.limit ?? 50));
  if (query.search?.trim()) {
    params.set("search", query.search.trim());
  }
  return apiRequest(`/api/v1/regos/partners?${params.toString()}`, { token });
}

export async function fetchPartner(token: string, partnerId: number): Promise<Partner> {
  return apiRequest(`/api/v1/regos/partners/${partnerId}`, { token });
}

export async function fetchPartnerGroups(token: string): Promise<PartnerGroupsResponse> {
  return apiRequest("/api/v1/regos/partner-groups", { token });
}

const FIRMS_CACHE_TTL_MS = 5 * 60 * 1000;

type FirmsCacheEntry = {
  data: FirmsListResponse;
  expiresAt: number;
};

const firmsCache = new Map<string, FirmsCacheEntry>();
const firmsInflight = new Map<string, Promise<FirmsListResponse>>();

export async function fetchFirms(
  token: string,
  options?: { force?: boolean },
): Promise<FirmsListResponse> {
  if (!options?.force) {
    const cached = firmsCache.get(token);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    const pending = firmsInflight.get(token);
    if (pending) return pending;
  }

  const request = apiRequest<FirmsListResponse>("/api/v1/regos/firms", { token })
    .then((data) => {
      firmsCache.set(token, { data, expiresAt: Date.now() + FIRMS_CACHE_TTL_MS });
      firmsInflight.delete(token);
      return data;
    })
    .catch((error) => {
      firmsInflight.delete(token);
      throw error;
    });

  firmsInflight.set(token, request);
  return request;
}

export function invalidateFirmsCache(token?: string) {
  if (token) {
    firmsCache.delete(token);
    firmsInflight.delete(token);
    return;
  }
  firmsCache.clear();
  firmsInflight.clear();
}

export async function createPartner(
  token: string,
  body: PartnerCreateRequest,
): Promise<{ id: number }> {
  return apiRequest("/api/v1/regos/partners", {
    method: "POST",
    token,
    body,
  });
}

export async function updatePartner(
  token: string,
  partnerId: number,
  body: PartnerUpdateRequest,
): Promise<{ row_affected: number }> {
  return apiRequest(`/api/v1/regos/partners/${partnerId}`, {
    method: "PATCH",
    token,
    body,
  });
}

export async function deleteMarkPartner(
  token: string,
  partnerId: number,
): Promise<{ row_affected: number }> {
  return apiRequest(`/api/v1/regos/partners/${partnerId}/delete-mark`, {
    method: "POST",
    token,
  });
}

type PartnerBalanceQuery = {
  startDate: number;
  endDate: number;
  firmId?: number | null;
  currencyId?: number | null;
  mode?: PartnerBalanceMode;
};

export async function fetchPartnerBalance(
  token: string,
  partnerId: number,
  query: PartnerBalanceQuery,
): Promise<PartnerBalanceResponse> {
  const params = new URLSearchParams();
  params.set("start_date", String(query.startDate));
  params.set("end_date", String(query.endDate));
  if (query.firmId) {
    params.set("firm_id", String(query.firmId));
  }
  if (query.currencyId) {
    params.set("currency_id", String(query.currencyId));
  }
  if (query.mode === "base_currency") {
    params.set("in_base_currency", "true");
  }
  return apiRequest(`/api/v1/regos/partners/${partnerId}/balance?${params.toString()}`, {
    token,
  });
}
