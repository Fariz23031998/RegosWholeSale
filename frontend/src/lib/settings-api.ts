import { apiRequest } from "@/lib/api";
import type {
  PosSettingsPatchRequest,
  PosSettingsResponse,
  RegosDefaultsPatchRequest,
  RegosDefaultsResponse,
  RegosDocPaymentSaleIdFieldResponse,
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

export async function fetchRegosDefaults(token: string): Promise<RegosDefaultsResponse> {
  return apiRequest("/api/v1/company/settings/regos-defaults", { token });
}

export async function patchRegosDefaults(
  token: string,
  body: RegosDefaultsPatchRequest,
): Promise<RegosDefaultsResponse> {
  return apiRequest("/api/v1/company/settings/regos-defaults", {
    method: "PATCH",
    token,
    body,
  });
}

export async function fetchRegosReferenceOptions(
  token: string,
): Promise<RegosReferenceOptionsResponse> {
  return apiRequest("/api/v1/regos/reference-options", { token });
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

export async function fetchMyRegosDefaults(token: string): Promise<RegosDefaultsResponse> {
  return apiRequest("/api/v1/me/settings/regos-defaults", { token });
}

export async function fetchUserPosSettings(token: string): Promise<UserPosSettingsResponse> {
  return apiRequest("/api/v1/me/settings/pos", { token });
}

export async function patchUserPosSettings(
  token: string,
  body: UserPosSettingsPatchRequest,
): Promise<UserPosSettingsResponse> {
  return apiRequest("/api/v1/me/settings/pos", {
    method: "PATCH",
    token,
    body,
  });
}
