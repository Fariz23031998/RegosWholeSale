import { apiRequest } from "@/lib/api";
import type { RegosCurrencyOption } from "@/types/settings";

export type CheckoutItemRequest = {  regos_item_id: number;
  qty: number;
  price: number;
};

export type CheckoutPaymentLineRequest = {
  payment_type_id: number;
  amount_paid: number;
  tendered?: number;
  change?: number;
};

export type CheckoutRequest = {
  items: CheckoutItemRequest[];
  discount: number;
  payment_type_id?: number;
  payments?: CheckoutPaymentLineRequest[];
  total: number;
  amount_paid?: number;
  tendered?: number;
  change?: number;
  description?: string;
  wholesale_doc_id?: number;
  warehouse_id?: number;
  price_type_id?: number;
  partner_id?: number;
};

export type CheckoutLineResponse = {
  regos_item_id: number;
  qty: number;
  price: number;
  price2: number;
};

export type CheckoutPaymentResponse = {
  payment_type_id: number;
  payment_doc_id: number | null;
  amount: number;
  amount_paid: number;
  balance_due: number;
  is_fully_paid: boolean;
  tendered?: number | null;
  change?: number | null;
  sale_currency?: RegosCurrencyOption | null;
  payment_currency?: RegosCurrencyOption | null;
  payment_amount?: number | null;
};
export type PostponeRequest = {
  items: CheckoutItemRequest[];
  discount: number;
  total: number;
  description?: string;
  wholesale_doc_id?: number;
  warehouse_id?: number;
  price_type_id?: number;
  partner_id?: number;
};

export type PostponeResponse = {
  wholesale_doc_id: number;
  wholesale_code: string;
  lines: CheckoutLineResponse[];
  subtotal: number;
  discount: number;
  total: number;
};

export type CheckoutResponse = {
  wholesale_doc_id: number;
  wholesale_code: string;
  payment_doc_id: number | null;
  performed_at: string;
  lines: CheckoutLineResponse[];
  payment: CheckoutPaymentResponse;
  payments?: CheckoutPaymentResponse[];
  subtotal: number;
  discount: number;
  total: number;
  amount_paid: number;
  balance_due: number;
  is_fully_paid: boolean;
};

export type WholesaleDocument = {
  id: number;
  code: string;
  date: number;
  partner_id: number | null;
  partner_name: string | null;
  partner_phone?: string | null;
  stock_id: number | null;
  stock_name: string | null;
  attached_user_id: number | null;
  attached_user_name: string | null;
  amount: number | null;
  performed: boolean;
  currency?: RegosCurrencyOption | null;
};

export type WholesaleDocumentsResponse = {
  documents: WholesaleDocument[];
  next_offset: number;
  total: number;
};

import type { ReceiptOperationItem } from "@/lib/receipt-operation-item";

export type WholesaleOperationLine = {
  id: number;
  document_id: number;
  item_id: number;
  item_code: string | null;
  item_name: string | null;
  item_group_id?: number | null;
  item_group_name?: string | null;
  item_unit_name?: string | null;
  item_brand?: string | null;
  quantity: number;
  price: number;
  price2: number | null;
  amount: number | null;
  item?: ReceiptOperationItem;
};

export type WholesaleOperationsResponse = {
  operations: WholesaleOperationLine[];
};

export type WholesalePaymentLine = {
  id: number;
  code: string;
  date: number;
  amount: number | null;
  category_id: number | null;
  category_name: string | null;
  payment_type_name: string | null;
  partner_id: number | null;
  partner_name: string | null;
  attached_user_id: number | null;
  attached_user_name: string | null;
  exchange_rate: number | null;
  currency?: RegosCurrencyOption | null;
};

export type WholesalePaymentsResponse = {
  payments: WholesalePaymentLine[];
};

export type WholesaleReturnDocument = WholesaleDocument & {
  description?: string | null;
  wholesale_doc_id?: number | null;
  reason?: string | null;
};

export type WholesaleReturnDocumentsResponse = {
  documents: WholesaleReturnDocument[];
  next_offset: number;
  total: number;
};

export type WholesaleReturnSummaryItem = {
  item_id: number;
  returned_qty: number;
};

export type WholesaleReturnSummaryResponse = {
  wholesale_doc_id: number;
  items: WholesaleReturnSummaryItem[];
};

export type WholesaleReturnItemRequest = {
  regos_item_id: number;
  qty: number;
  price?: number;
};

export type WholesaleReturnRequest = {
  wholesale_doc_id?: number | null;
  items: WholesaleReturnItemRequest[];
  total: number;
  reason?: string;
  payment_type_id?: number;
  payments?: CheckoutPaymentLineRequest[];
  amount_paid?: number;
  tendered?: number;
  change?: number;
  warehouse_id?: number;
  price_type_id?: number;
  partner_id?: number;
};

export type WholesaleReturnLineResponse = {
  regos_item_id: number;
  qty: number;
  price: number;
  price2: number;
};

export type WholesaleReturnResponse = {
  wholesale_return_doc_id: number;
  wholesale_return_code: string;
  wholesale_doc_id: number | null;
  performed_at: string;
  lines: WholesaleReturnLineResponse[];
  total: number;
  reason?: string | null;
  payment_doc_id: number | null;
  payment: CheckoutPaymentResponse;
  payments?: CheckoutPaymentResponse[];
  amount_paid: number;
  balance_due: number;
  is_fully_paid: boolean;
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

export async function postponeSale(
  token: string,
  body: PostponeRequest,
): Promise<PostponeResponse> {
  return apiRequest("/api/v1/sales/postpone", {
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
    all_stocks?: boolean;
    stock_ids?: number[];
    all_partners?: boolean;
    partner_ids?: number[];
    performed?: boolean;
    offset?: number;
    limit?: number;
  } = {},
): Promise<WholesaleDocumentsResponse> {
  const search = new URLSearchParams();
  if (params.start_date !== undefined) search.set("start_date", String(params.start_date));
  if (params.end_date !== undefined) search.set("end_date", String(params.end_date));
  if (params.all_stocks !== undefined) search.set("all_stocks", params.all_stocks ? "true" : "false");
  if (params.all_partners !== undefined) search.set("all_partners", params.all_partners ? "true" : "false");
  if (params.performed !== undefined) search.set("performed", params.performed ? "true" : "false");
  if (params.stock_ids?.length) {
    for (const stockId of params.stock_ids) {
      search.append("stock_ids", String(stockId));
    }
  }
  if (params.partner_ids?.length) {
    for (const partnerId of params.partner_ids) {
      search.append("partner_ids", String(partnerId));
    }
  }
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

export async function fetchWholesaleDocumentPayments(
  token: string,
  documentId: number,
): Promise<WholesalePaymentsResponse> {
  return apiRequest(`/api/v1/sales/wholesale-documents/${documentId}/payments`, {
    token,
  });
}

export async function fetchWholesaleOperationsBatch(
  token: string,
  documentIds: number[],
): Promise<WholesaleOperationsResponse> {
  if (documentIds.length === 0) {
    return { operations: [] };
  }
  const search = new URLSearchParams();
  for (const id of documentIds) {
    search.append("document_ids", String(id));
  }
  return apiRequest(`/api/v1/sales/wholesale-operations?${search.toString()}`, { token });
}

export async function fetchWholesaleReturnDocuments(
  token: string,
  params: {
    start_date?: number;
    end_date?: number;
    all_stocks?: boolean;
    stock_ids?: number[];
    all_partners?: boolean;
    partner_ids?: number[];
    offset?: number;
    limit?: number;
  } = {},
): Promise<WholesaleReturnDocumentsResponse> {
  const search = new URLSearchParams();
  if (params.start_date !== undefined) search.set("start_date", String(params.start_date));
  if (params.end_date !== undefined) search.set("end_date", String(params.end_date));
  if (params.all_stocks !== undefined) search.set("all_stocks", params.all_stocks ? "true" : "false");
  if (params.all_partners !== undefined) search.set("all_partners", params.all_partners ? "true" : "false");
  if (params.stock_ids?.length) {
    for (const stockId of params.stock_ids) {
      search.append("stock_ids", String(stockId));
    }
  }
  if (params.partner_ids?.length) {
    for (const partnerId of params.partner_ids) {
      search.append("partner_ids", String(partnerId));
    }
  }
  if (params.offset !== undefined) search.set("offset", String(params.offset));
  if (params.limit !== undefined) search.set("limit", String(params.limit));
  const qs = search.toString();
  return apiRequest(`/api/v1/sales/wholesale-return-documents${qs ? `?${qs}` : ""}`, { token });
}

export async function fetchWholesaleReturnOperations(
  token: string,
  documentId: number,
): Promise<WholesaleOperationsResponse> {
  return apiRequest(`/api/v1/sales/wholesale-return-documents/${documentId}/operations`, {
    token,
  });
}

export async function fetchWholesaleReturnDocumentPayments(
  token: string,
  documentId: number,
): Promise<WholesalePaymentsResponse> {
  return apiRequest(`/api/v1/sales/wholesale-return-documents/${documentId}/payments`, {
    token,
  });
}

export async function fetchWholesaleReturnSummary(
  token: string,
  wholesaleDocId: number,
): Promise<WholesaleReturnSummaryResponse> {
  return apiRequest(`/api/v1/sales/wholesale-documents/${wholesaleDocId}/return-summary`, {
    token,
  });
}

export async function submitWholesaleReturn(
  token: string,
  body: WholesaleReturnRequest,
): Promise<WholesaleReturnResponse> {
  return apiRequest("/api/v1/sales/wholesale-returns", {
    method: "POST",
    token,
    body,
  });
}
