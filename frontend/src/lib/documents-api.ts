import { apiRequest } from "@/lib/api";
import type {
  DocumentPrintResponse,
  DocumentStationsResponse,
  ReceiptPrintPatchRequest,
  ReceiptTemplatesResponse,
  UserDocumentPrintPatchRequest,
  UserDocumentPrintSettingsResponse,
} from "@/types/receipt-templates";

export async function fetchDocumentStations(token: string): Promise<DocumentStationsResponse> {
  return apiRequest<DocumentStationsResponse>("/api/v1/documents/stations", { token });
}

export async function printDocument(
  token: string,
  body: {
    template_id?: string | null;
    html: string;
    copies?: number;
    station_id?: string | null;
    printer_name?: string | null;
  },
): Promise<DocumentPrintResponse> {
  return apiRequest<DocumentPrintResponse>("/api/v1/documents/print", {
    method: "POST",
    token,
    body,
  });
}

export async function patchReceiptPrintSettings(
  token: string,
  body: ReceiptPrintPatchRequest,
): Promise<ReceiptTemplatesResponse> {
  return apiRequest<ReceiptTemplatesResponse>("/api/v1/company/settings/receipt-print", {
    method: "PATCH",
    token,
    body,
  });
}

export async function fetchMyDocumentPrintSettings(
  token: string,
): Promise<UserDocumentPrintSettingsResponse> {
  return apiRequest<UserDocumentPrintSettingsResponse>("/api/v1/me/settings/document-print", {
    token,
  });
}

export async function patchMyDocumentPrintSettings(
  token: string,
  body: UserDocumentPrintPatchRequest,
): Promise<UserDocumentPrintSettingsResponse> {
  return apiRequest<UserDocumentPrintSettingsResponse>("/api/v1/me/settings/document-print", {
    method: "PATCH",
    token,
    body,
  });
}

export async function fetchUserDocumentPrintSettings(
  token: string,
  userId: number,
): Promise<UserDocumentPrintSettingsResponse> {
  return apiRequest<UserDocumentPrintSettingsResponse>(
    `/api/v1/users/${userId}/settings/document-print`,
    { token },
  );
}

export async function patchUserDocumentPrintSettings(
  token: string,
  userId: number,
  body: UserDocumentPrintPatchRequest,
): Promise<UserDocumentPrintSettingsResponse> {
  return apiRequest<UserDocumentPrintSettingsResponse>(
    `/api/v1/users/${userId}/settings/document-print`,
    {
      method: "PATCH",
      token,
      body,
    },
  );
}
