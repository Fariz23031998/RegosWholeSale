import { apiRequest } from "@/lib/api";
import type {
  PosSettingsResponse,
  RegosDefaultsPatchRequest,
  RegosDefaultsResponse,
  UserPosSettingsPatchRequest,
  UserPosSettingsResponse,
} from "@/types/settings";
import type {
  Permission,
  UserCreateRequest,
  UserDetail,
  UserUpdateRequest,
} from "@/types/users";

export async function fetchUsers(token: string): Promise<UserDetail[]> {
  return apiRequest("/api/v1/users", { token });
}

export async function createUser(token: string, body: UserCreateRequest): Promise<UserDetail> {
  return apiRequest("/api/v1/users", {
    method: "POST",
    token,
    body,
  });
}

export async function patchUser(
  token: string,
  userId: number,
  body: UserUpdateRequest,
): Promise<UserDetail> {
  return apiRequest(`/api/v1/users/${userId}`, {
    method: "PATCH",
    token,
    body,
  });
}

export async function deactivateUser(token: string, userId: number): Promise<UserDetail> {
  return apiRequest(`/api/v1/users/${userId}`, {
    method: "DELETE",
    token,
  });
}

export async function fetchPermissions(token: string): Promise<Permission[]> {
  return apiRequest("/api/v1/permissions", { token });
}

export async function fetchCompanyPosSettings(token: string): Promise<PosSettingsResponse> {
  return apiRequest("/api/v1/company/settings/pos", { token });
}

export async function fetchUserPosSettingsById(
  token: string,
  userId: number,
): Promise<UserPosSettingsResponse> {
  return apiRequest(`/api/v1/users/${userId}/settings/pos`, { token });
}

export async function patchUserPosSettingsById(
  token: string,
  userId: number,
  body: UserPosSettingsPatchRequest,
): Promise<UserPosSettingsResponse> {
  return apiRequest(`/api/v1/users/${userId}/settings/pos`, {
    method: "PATCH",
    token,
    body,
  });
}

export async function clearUserPosSettings(
  token: string,
  userId: number,
): Promise<UserPosSettingsResponse> {
  return apiRequest(`/api/v1/users/${userId}/settings/pos`, {
    method: "DELETE",
    token,
  });
}

export async function fetchUserRegosDefaultsById(
  token: string,
  userId: number,
): Promise<RegosDefaultsResponse> {
  return apiRequest(`/api/v1/users/${userId}/settings/regos-defaults`, { token });
}

export async function patchUserRegosDefaultsById(
  token: string,
  userId: number,
  body: RegosDefaultsPatchRequest,
): Promise<RegosDefaultsResponse> {
  return apiRequest(`/api/v1/users/${userId}/settings/regos-defaults`, {
    method: "PATCH",
    token,
    body,
  });
}

export async function clearUserRegosDefaults(
  token: string,
  userId: number,
): Promise<RegosDefaultsResponse> {
  return apiRequest(`/api/v1/users/${userId}/settings/regos-defaults`, {
    method: "DELETE",
    token,
  });
}
