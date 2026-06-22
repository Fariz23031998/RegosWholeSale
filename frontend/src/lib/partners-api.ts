import { apiRequest } from "@/lib/api";
import type {
  Partner,
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
