import { apiRequest } from "@/lib/api";
import type {
  EmployeeDebtResponse,
  Shift,
  ShiftCloseRequest,
  ShiftListResponse,
  ShiftOpenRequest,
  ShiftOperationCreateRequest,
  ShiftStatus,
} from "@/types/shifts";

export type ShiftsListQuery = {
  user_id?: number | null;
  status?: ShiftStatus | null;
  offset?: number;
  limit?: number;
};

function buildShiftsQuery(query: ShiftsListQuery): string {
  const params = new URLSearchParams();
  if (query.user_id != null) params.set("user_id", String(query.user_id));
  if (query.status) params.set("status", query.status);
  params.set("offset", String(query.offset ?? 0));
  params.set("limit", String(query.limit ?? 50));
  return params.toString();
}

export async function fetchShifts(
  token: string,
  query: ShiftsListQuery = {},
): Promise<ShiftListResponse> {
  return apiRequest(`/api/v1/shifts?${buildShiftsQuery(query)}`, { token });
}

export async function fetchCurrentShift(token: string): Promise<Shift | null> {
  return apiRequest(`/api/v1/shifts/current`, { token });
}

export async function fetchShift(token: string, shiftId: number): Promise<Shift> {
  return apiRequest(`/api/v1/shifts/${shiftId}`, { token });
}

export async function openShift(token: string, body: ShiftOpenRequest): Promise<Shift> {
  return apiRequest(`/api/v1/shifts/open`, {
    token,
    method: "POST",
    body,
  });
}

export async function closeShift(
  token: string,
  shiftId: number,
  body: ShiftCloseRequest,
): Promise<Shift> {
  return apiRequest(`/api/v1/shifts/${shiftId}/close`, {
    token,
    method: "POST",
    body,
  });
}

export async function addShiftOperation(
  token: string,
  shiftId: number,
  body: ShiftOperationCreateRequest,
): Promise<Shift> {
  return apiRequest(`/api/v1/shifts/${shiftId}/operations`, {
    token,
    method: "POST",
    body,
  });
}

export async function fetchEmployeeDebt(
  token: string,
  userId: number,
): Promise<EmployeeDebtResponse> {
  return apiRequest(`/api/v1/shifts/employees/${userId}/debt`, { token });
}
