import { apiRequest } from "@/lib/api";

export type PriceDocument = {
  id: number;
  code: string;
  date: number;
  price_type_id: number | null;
  price_type_name: string;
  description: string;
  performed: boolean;
};

export type PriceDocumentsResponse = {
  documents: PriceDocument[];
  next_offset: number;
  total: number;
};

export type PriceDocumentOperation = {
  id: number;
  item_id: number;
  item_code: string;
  item_name: string;
  base_value: number;
  new_value: number;
};

type ListQuery = {
  startDate?: number;
  endDate?: number;
  search?: string;
  priceTypeId?: number;
  offset?: number;
  limit?: number;
};

export async function fetchPriceDocuments(
  token: string,
  query: ListQuery = {},
): Promise<PriceDocumentsResponse> {
  const params = new URLSearchParams();
  if (query.startDate != null) params.set("start_date", String(query.startDate));
  if (query.endDate != null) params.set("end_date", String(query.endDate));
  if (query.search?.trim()) params.set("search", query.search.trim());
  if (query.priceTypeId) params.set("price_type_id", String(query.priceTypeId));
  params.set("offset", String(query.offset ?? 0));
  params.set("limit", String(query.limit ?? 100));
  const suffix = params.toString();
  return apiRequest(`/api/v1/regos/price-documents${suffix ? `?${suffix}` : ""}`, { token });
}

export async function fetchPriceDocument(token: string, documentId: number): Promise<PriceDocument> {
  return apiRequest(`/api/v1/regos/price-documents/${documentId}`, { token });
}

export async function fetchPriceDocumentOperations(
  token: string,
  documentId: number,
): Promise<{ operations: PriceDocumentOperation[] }> {
  return apiRequest(`/api/v1/regos/price-documents/${documentId}/operations`, { token });
}
