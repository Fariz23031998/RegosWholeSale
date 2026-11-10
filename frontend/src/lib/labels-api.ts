import { apiRequest } from "@/lib/api";
import type {
  LabelPrintResponse,
  LabelRenderResponse,
  LabelRowsResponse,
  LabelSampleRowResponse,
} from "@/types/label-templates";

type LabelJobRequest = {
  template_id?: string | null;
  product_ids: number[];
  copies: number;
  station_id?: string | null;
  printer_name?: string | null;
  warehouse_id?: number;
  price_type_id?: number;
  use_warehouse_quantity?: boolean;
  html_pages?: string[];
};

export async function printProductLabels(
  token: string,
  body: LabelJobRequest,
): Promise<LabelPrintResponse> {
  return apiRequest<LabelPrintResponse>("/api/v1/labels/print", {
    method: "POST",
    token,
    body,
  });
}

export async function renderProductLabels(
  token: string,
  body: Omit<LabelJobRequest, "station_id" | "html_pages">,
): Promise<LabelRenderResponse> {
  return apiRequest<LabelRenderResponse>("/api/v1/labels/render", {
    method: "POST",
    token,
    body,
  });
}

export async function fetchLabelRows(
  token: string,
  body: Omit<LabelJobRequest, "station_id" | "printer_name" | "html_pages">,
): Promise<LabelRowsResponse> {
  return apiRequest<LabelRowsResponse>("/api/v1/labels/rows", {
    method: "POST",
    token,
    body,
  });
}

export async function fetchLabelSampleRow(token: string): Promise<LabelSampleRowResponse> {
  return apiRequest<LabelSampleRowResponse>("/api/v1/labels/sample-row", {
    method: "POST",
    token,
    body: {},
  });
}
