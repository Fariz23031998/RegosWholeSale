import { apiRequest } from "@/lib/api";
import type { RegosCurrencyOption } from "@/types/settings";

export type StockDocKind =
  | "purchase"
  | "movement"
  | "inventory"
  | "wholesale"
  | "inout"
  | "return_to_partner";

export type StockDocument = {
  id: number;
  code: string;
  date: number;
  open_date?: number | null;
  close_date?: number | null;
  partner_id: number | null;
  partner_name: string | null;
  stock_id: number | null;
  stock_name: string | null;
  stock_sender_id?: number | null;
  stock_sender_name?: string | null;
  stock_receiver_id?: number | null;
  stock_receiver_name?: string | null;
  price_type_id?: number | null;
  attached_user_id: number | null;
  attached_user_name: string | null;
  amount: number | null;
  performed: boolean;
  closed?: boolean;
  blocked?: boolean;
  currency?: RegosCurrencyOption | null;
  description?: string | null;
  compare_type?: string | null;
  vat_calculation_type?: string | null;
  inout_type?: string | null;
};

export type StockDocumentsResponse = {
  documents: StockDocument[];
  next_offset: number;
  total: number;
};

export type StockOperationLine = {
  id: number;
  document_id: number;
  item_id: number;
  item_code: string | null;
  item_name: string | null;
  item_unit_name: string | null;
  quantity: number;
  cost: number | null;
  price: number | null;
  price2: number | null;
  amount: number | null;
  description: string | null;
  vat_value: number | null;
};

export type StockOperationsResponse = {
  operations: StockOperationLine[];
};

export type StockDocumentCreateRequest = {
  date?: number;
  partner_id?: number;
  stock_id?: number;
  stock_sender_id?: number;
  stock_receiver_id?: number;
  currency_id?: number;
  price_type_id?: number;
  attached_user_id?: number;
  vat_calculation_type?: string;
  compare_type?: string;
  description?: string;
  inout_type?: string;
};

export type StockDocumentUpdateRequest = {
  date?: number;
  partner_id?: number;
  stock_id?: number;
  stock_sender_id?: number;
  stock_receiver_id?: number;
  currency_id?: number;
  price_type_id?: number;
  attached_user_id?: number;
  vat_calculation_type?: string;
  compare_type?: string;
  description?: string;
  inout_type?: string;
};

export type StockDocumentCreateResponse = {
  id: number;
  code: string | null;
};

export type StockMutationResponse = {
  ok: boolean;
  row_affected: number | null;
};

export type StockOperationAddItem = {
  document_id: number;
  item_id: number;
  quantity?: number;
  actual_quantity?: number;
  cost?: number;
  price?: number;
  price2?: number;
  vat_value?: number;
  description?: string;
  datetime?: number;
  update_actual_quantity?: boolean;
};

export type StockOperationEditItem = {
  id: number;
  quantity?: number;
  actual_quantity?: number;
  cost?: number;
  price?: number;
  description?: string;
  update_actual_quantity?: boolean;
};

export type StockItemSearchHit = {
  id: number;
  name: string;
  barcode: string | null;
  code: string | null;
  articul: string | null;
  unit: string | null;
  unit_piece: boolean;
  vat_value: number | null;
  last_purchase_cost: number | null;
  price: number | null;
  price2: number | null;
  quantity_common: number | null;
};

export type StockItemInfoResponse = {
  item: StockItemSearchHit;
  quantities: Array<{
    stock_id: number;
    stock_name: string | null;
    quantity: number;
  }>;
  prices: Array<{
    price_type_id: number;
    price_type_name: string | null;
    price: number;
    currency_code: string | null;
  }>;
  operations: Array<{
    id: number | null;
    datetime: number | null;
    document_code: string | null;
    document_type: string | null;
    stock_id: number | null;
    stock_name: string | null;
    quantity: number | null;
    price: number | null;
  }>;
  similar: StockItemSearchHit[];
};

export type StockDocumentsQuery = {
  start_date?: number;
  end_date?: number;
  partner_ids?: number[];
  all_partners?: boolean;
  stock_ids?: number[];
  all_stocks?: boolean;
  performed?: boolean;
  search?: string;
  inout_type?: string;
  offset?: number;
  limit?: number;
};

function stockQueryString(params: StockDocumentsQuery): string {
  const search = new URLSearchParams();
  if (params.start_date !== undefined) search.set("start_date", String(params.start_date));
  if (params.end_date !== undefined) search.set("end_date", String(params.end_date));
  if (params.all_stocks !== undefined) search.set("all_stocks", params.all_stocks ? "true" : "false");
  if (params.all_partners !== undefined) {
    search.set("all_partners", params.all_partners ? "true" : "false");
  }
  if (params.performed !== undefined) search.set("performed", params.performed ? "true" : "false");
  if (params.search) search.set("search", params.search);
  if (params.inout_type) search.set("inout_type", params.inout_type);
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
  return qs ? `?${qs}` : "";
}

export async function fetchStockDocuments(
  token: string,
  kind: StockDocKind,
  params: StockDocumentsQuery = {},
): Promise<StockDocumentsResponse> {
  return apiRequest<StockDocumentsResponse>(`/api/v1/stock/${kind}/documents${stockQueryString(params)}`, {
    token,
  });
}

export async function fetchStockDocument(
  token: string,
  kind: StockDocKind,
  documentId: number,
): Promise<StockDocument> {
  return apiRequest<StockDocument>(`/api/v1/stock/${kind}/documents/${documentId}`, { token });
}

export async function fetchStockOperations(
  token: string,
  kind: StockDocKind,
  documentId: number,
  search?: string,
): Promise<StockOperationsResponse> {
  const qs = search ? `?search=${encodeURIComponent(search)}` : "";
  return apiRequest<StockOperationsResponse>(
    `/api/v1/stock/${kind}/documents/${documentId}/operations${qs}`,
    { token },
  );
}

export async function createStockDocument(
  token: string,
  kind: StockDocKind,
  body: StockDocumentCreateRequest,
): Promise<StockDocumentCreateResponse> {
  return apiRequest<StockDocumentCreateResponse>(`/api/v1/stock/${kind}/documents`, {
    method: "POST",
    token,
    body,
  });
}

export async function updateStockDocument(
  token: string,
  kind: StockDocKind,
  documentId: number,
  body: StockDocumentUpdateRequest,
): Promise<StockMutationResponse> {
  return apiRequest<StockMutationResponse>(`/api/v1/stock/${kind}/documents/${documentId}`, {
    method: "PATCH",
    token,
    body,
  });
}

export async function performStockDocument(
  token: string,
  kind: StockDocKind,
  documentId: number,
): Promise<StockMutationResponse> {
  return apiRequest<StockMutationResponse>(
    `/api/v1/stock/${kind}/documents/${documentId}/perform`,
    { method: "POST", token },
  );
}

export async function performCancelStockDocument(
  token: string,
  kind: StockDocKind,
  documentId: number,
): Promise<StockMutationResponse> {
  return apiRequest<StockMutationResponse>(
    `/api/v1/stock/${kind}/documents/${documentId}/perform-cancel`,
    { method: "POST", token },
  );
}

export async function lockStockDocument(
  token: string,
  kind: StockDocKind,
  documentId: number,
): Promise<StockMutationResponse> {
  return apiRequest<StockMutationResponse>(
    `/api/v1/stock/${kind}/documents/${documentId}/lock`,
    { method: "POST", token },
  );
}

export async function unlockStockDocument(
  token: string,
  kind: StockDocKind,
  documentId: number,
): Promise<StockMutationResponse> {
  return apiRequest<StockMutationResponse>(
    `/api/v1/stock/${kind}/documents/${documentId}/unlock`,
    { method: "POST", token },
  );
}

export async function addStockOperations(
  token: string,
  kind: StockDocKind,
  operations: StockOperationAddItem[],
): Promise<StockMutationResponse> {
  return apiRequest<StockMutationResponse>(`/api/v1/stock/${kind}/operations`, {
    method: "POST",
    token,
    body: { operations },
  });
}

export async function editStockOperations(
  token: string,
  kind: StockDocKind,
  operations: StockOperationEditItem[],
): Promise<StockMutationResponse> {
  return apiRequest<StockMutationResponse>(`/api/v1/stock/${kind}/operations`, {
    method: "PATCH",
    token,
    body: { operations },
  });
}

export async function deleteStockOperations(
  token: string,
  kind: StockDocKind,
  ids: number[],
): Promise<StockMutationResponse> {
  return apiRequest<StockMutationResponse>(`/api/v1/stock/${kind}/operations`, {
    method: "DELETE",
    token,
    body: { ids },
  });
}

export async function searchStockItems(
  token: string,
  params: {
    search: string;
    stock_id?: number;
    price_type_id?: number;
    limit?: number;
  },
): Promise<{ items: StockItemSearchHit[] }> {
  const qs = new URLSearchParams();
  qs.set("search", params.search);
  if (params.stock_id != null) qs.set("stock_id", String(params.stock_id));
  if (params.price_type_id != null) qs.set("price_type_id", String(params.price_type_id));
  if (params.limit != null) qs.set("limit", String(params.limit));
  return apiRequest<{ items: StockItemSearchHit[] }>(`/api/v1/stock/item-info?${qs}`, { token });
}

export async function fetchStockItemInfo(
  token: string,
  itemId: number,
  params: {
    stock_id?: number;
    price_type_id?: number;
    operation_limit?: number;
  } = {},
): Promise<StockItemInfoResponse> {
  const qs = new URLSearchParams();
  if (params.stock_id != null) qs.set("stock_id", String(params.stock_id));
  if (params.price_type_id != null) qs.set("price_type_id", String(params.price_type_id));
  if (params.operation_limit != null) qs.set("operation_limit", String(params.operation_limit));
  const suffix = qs.toString() ? `?${qs}` : "";
  return apiRequest<StockItemInfoResponse>(`/api/v1/stock/item-info/${itemId}${suffix}`, { token });
}
