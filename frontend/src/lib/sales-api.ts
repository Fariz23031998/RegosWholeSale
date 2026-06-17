import { apiRequest } from "@/lib/api";

export type CheckoutItemRequest = {
  regos_item_id: number;
  qty: number;
  price: number;
};

export type CheckoutRequest = {
  items: CheckoutItemRequest[];
  discount: number;
  payment_type_id: number;
  total: number;
  tendered?: number;
  change?: number;
  description?: string;
};

export type CheckoutLineResponse = {
  regos_item_id: number;
  qty: number;
  price: number;
  price2: number;
};

export type CheckoutPaymentResponse = {
  payment_type_id: number;
  payment_doc_id: number;
  amount: number;
  tendered?: number | null;
  change?: number | null;
};

export type CheckoutResponse = {
  wholesale_doc_id: number;
  wholesale_code: string;
  payment_doc_id: number;
  performed_at: string;
  lines: CheckoutLineResponse[];
  payment: CheckoutPaymentResponse;
  subtotal: number;
  discount: number;
  total: number;
};

export type WholesaleDocument = {
  id: number;
  code: string;
  date: number;
  partner_id: number | null;
  partner_name: string | null;
  stock_id: number | null;
  stock_name: string | null;
  amount: number | null;
  performed: boolean;
};

export type WholesaleDocumentsResponse = {
  documents: WholesaleDocument[];
  next_offset: number;
  total: number;
};

export type WholesaleOperationLine = {
  id: number;
  document_id: number;
  item_id: number;
  item_name: string | null;
  quantity: number;
  price: number;
  price2: number | null;
  amount: number | null;
};

export type WholesaleOperationsResponse = {
  operations: WholesaleOperationLine[];
};

export async function checkoutSale(
  token: string,
  body: CheckoutRequest,
): Promise<CheckoutResponse> {
  return apiRequest("/api/v1/sales/checkout", {
    method: "POST",
    token,
    body,
  });
}

export async function fetchWholesaleDocuments(
  token: string,
  params: {
    start_date?: number;
    end_date?: number;
    offset?: number;
    limit?: number;
  } = {},
): Promise<WholesaleDocumentsResponse> {
  const search = new URLSearchParams();
  if (params.start_date !== undefined) search.set("start_date", String(params.start_date));
  if (params.end_date !== undefined) search.set("end_date", String(params.end_date));
  if (params.offset !== undefined) search.set("offset", String(params.offset));
  if (params.limit !== undefined) search.set("limit", String(params.limit));
  const qs = search.toString();
  return apiRequest(`/api/v1/sales/wholesale-documents${qs ? `?${qs}` : ""}`, { token });
}

export async function fetchWholesaleOperations(
  token: string,
  documentId: number,
): Promise<WholesaleOperationsResponse> {
  return apiRequest(`/api/v1/sales/wholesale-documents/${documentId}/operations`, {
    token,
  });
}
