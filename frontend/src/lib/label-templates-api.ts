import { apiRequest, getApiBaseUrl } from "@/lib/api";
import type {
  LabelPrintPatchRequest,
  LabelRenderResponse,
  LabelStationsResponse,
  LabelTemplate,
  LabelTemplatesPatchRequest,
  LabelTemplatesResponse,
  UserLabelPrintPatchRequest,
  UserLabelPrintSettingsResponse,
} from "@/types/label-templates";

type LabelPreviewRequest = {
  html: string;
  css: string;
  width_mm: number;
  height_mm: number;
};

export function printerNamesMatch(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

export function splitLabelDocument(html: string): { html: string; css: string } {
  const chunks: string[] = [];
  const stripped = html.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (_match, css: string) => {
    const sheet = css.trim();
    if (sheet) chunks.push(sheet);
    return "";
  });
  return { html: stripped, css: chunks.join("\n\n") };
}

export async function fetchLabelTemplates(token: string): Promise<LabelTemplatesResponse> {
  return apiRequest<LabelTemplatesResponse>("/api/v1/company/settings/label-templates", { token });
}

export async function patchLabelTemplates(
  token: string,
  body: LabelTemplatesPatchRequest,
): Promise<LabelTemplatesResponse> {
  return apiRequest<LabelTemplatesResponse>("/api/v1/company/settings/label-templates", {
    method: "PATCH",
    token,
    body,
  });
}

export async function patchLabelPrintSettings(
  token: string,
  body: LabelPrintPatchRequest,
): Promise<LabelTemplatesResponse> {
  return apiRequest<LabelTemplatesResponse>("/api/v1/company/settings/label-print", {
    method: "PATCH",
    token,
    body,
  });
}

export async function fetchMyLabelPrintSettings(
  token: string,
): Promise<UserLabelPrintSettingsResponse> {
  return apiRequest<UserLabelPrintSettingsResponse>("/api/v1/me/settings/label-print", { token });
}

export async function patchMyLabelPrintSettings(
  token: string,
  body: UserLabelPrintPatchRequest,
): Promise<UserLabelPrintSettingsResponse> {
  return apiRequest<UserLabelPrintSettingsResponse>("/api/v1/me/settings/label-print", {
    method: "PATCH",
    token,
    body,
  });
}

export async function fetchLabelStations(token: string): Promise<LabelStationsResponse> {
  return apiRequest<LabelStationsResponse>("/api/v1/labels/stations", { token });
}

export async function previewLabelTemplate(
  token: string,
  body: LabelPreviewRequest,
): Promise<LabelRenderResponse> {
  return apiRequest<LabelRenderResponse>("/api/v1/labels/preview", {
    method: "POST",
    token,
    body,
  });
}

export function printGatewayUrl(): string {
  const base = getApiBaseUrl() || (typeof window !== "undefined" ? window.location.origin : "");
  const url = new URL(base || "http://localhost:8000");
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/print-gateway/ws";
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function createLabelTemplate(): LabelTemplate {
  return {
    id: crypto.randomUUID(),
    name: "Label",
    is_default: false,
    paper: { width_mm: 58, height_mm: 40, orientation: "portrait" },
    html: `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
</head>
<body>
  <div class="label">
    <div class="name">{{ name }}</div>
    <div class="price">{{ price }} {{ currency }}</div>
    <img class="barcode" src="{{ barcode_src }}" alt="" />
    <div>{{ barcode }}</div>
  </div>
</body>
</html>`,
    css: `html, body { margin: 0; padding: 0; font-family: Arial, sans-serif; }
.label { box-sizing: border-box; width: 58mm; height: 40mm; padding: 2mm; }
.name { font-size: 12px; font-weight: 700; }
.price { font-size: 16px; font-weight: 700; margin-top: 1mm; }
img.barcode { height: 12mm; width: 100%; max-width: 100%; object-fit: fill; object-position: center; }`,
    logos: [],
    version: 1,
  };
}
