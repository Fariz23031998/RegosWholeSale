import { apiRequest, apiUpload } from "@/lib/api";
import type { PartnerEnabledPages, PartnerPortalPageKey } from "@/lib/partner-portal-pages";
import type { PartnerBalanceRow } from "@/types/partners";

export type PartnerOrderDocumentType = "doc_wholesale" | "doc_order_from_partner";

export type PartnerTelegramBotConfig = {
  configured: boolean;
  bot_username: string | null;
  token_masked: string;
  webhook_url: string | null;
  mini_app_url: string | null;
  public_key: string | null;
  default_warehouse_id: number | null;
  default_price_type_id: number | null;
  allow_catalog_warehouse_selection: boolean;
  allow_self_registration: boolean;
  show_product_quantities: boolean;
  auto_open_qty_keypad: boolean;
  default_partner_group_id: number | null;
  catalog_product_group_ids: number[];
  enabled_pages: PartnerEnabledPages;
  balance_notify_enabled: boolean;
  balance_notify_time: string;
  balance_notify_option: "daily" | "weekdays" | "monthly" | string;
  balance_notify_days: number[];
  balance_notify_templates: {
    uz: string;
    ru: string;
    en: string;
  };
  order_document_type: PartnerOrderDocumentType | string;
  order_booked: boolean;
};

export type PartnerTelegramBotMessage = {
  message: string;
  bot: PartnerTelegramBotConfig | null;
};

export type PartnerTelegramAccount = {
  id: number;
  telegram_user_id: number;
  chat_id: number;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  language_code: string | null;
  regos_partner_id: number | null;
  partner_name: string | null;
  link_state: "awaiting_language" | "unlinked" | "linked" | string;
  warehouse_id: number | null;
  price_type_id: number | null;
  page_overrides: Partial<Record<PartnerPortalPageKey, boolean>>;
  enabled_pages: PartnerEnabledPages;
  has_password: boolean;
  created_at: string;
};

export type PartnerCatalogProduct = {
  id: number;
  name: string;
  price: number;
  available: number;
  unit_name: string;
  image: string;
  sku: string;
  category?: string;
  code?: string;
  articul?: string;
  barcode?: string;
};

export type PartnerCatalogResponse = {
  products: PartnerCatalogProduct[];
  next_offset: number;
  total: number;
  currency_name: string;
  currency_code: string;
  warehouse_id: number;
  price_type_id: number;
};

export type PartnerWarehouseOption = {
  id: number;
  name: string;
};

export type PartnerCatalogOptions = {
  warehouse_id: number;
  allow_warehouse_selection: boolean;
  warehouses: PartnerWarehouseOption[];
  currency_name: string;
  currency_code: string;
  show_product_quantities: boolean;
  auto_open_qty_keypad: boolean;
};

export type PartnerPayment = {
  id: number;
  code: string | null;
  date: number | null;
  amount: number | null;
  description: string;
  payment_direction: string | null;
  payment_type_name: string | null;
  performed: boolean | null;
};

export type PartnerProductGroup = {
  id: number;
  parent_id?: number | null;
  name: string;
  path: string;
  child_count?: number;
};

export type PartnerDocumentSummary = {
  id: number;
  code: string | null;
  date: number | null;
  amount: number | null;
  description: string;
  status_id: number | null;
  performed: boolean | null;
  stock_name?: string | null;
  partner_name?: string | null;
};

export type PartnerDocumentLine = {
  item_code?: string | null;
  item_name: string;
  quantity: number;
  price: number;
  total: number;
};

export async function fetchPartnerTelegramBot(token: string): Promise<PartnerTelegramBotConfig> {
  return apiRequest("/api/v1/partner-telegram/bot", { token });
}

export async function savePartnerTelegramBot(
  token: string,
  botToken: string,
): Promise<PartnerTelegramBotMessage> {
  return apiRequest("/api/v1/partner-telegram/bot", {
    method: "PUT",
    token,
    body: { bot_token: botToken },
  });
}

export async function deletePartnerTelegramBot(token: string): Promise<PartnerTelegramBotMessage> {
  return apiRequest("/api/v1/partner-telegram/bot", { method: "DELETE", token });
}

export async function savePartnerTelegramBotSettings(
  token: string,
  body: {
    default_warehouse_id: number | null;
    default_price_type_id: number | null;
    allow_catalog_warehouse_selection: boolean;
    allow_self_registration: boolean;
    show_product_quantities: boolean;
    auto_open_qty_keypad: boolean;
    default_partner_group_id: number | null;
    catalog_product_group_ids: number[];
    enabled_pages: PartnerEnabledPages;
    balance_notify_enabled: boolean;
    balance_notify_time: string;
    balance_notify_option: "daily" | "weekdays" | "monthly";
    balance_notify_days: number[];
    balance_notify_templates: {
      uz: string;
      ru: string;
      en: string;
    };
    order_document_type: PartnerOrderDocumentType;
    order_booked: boolean;
  },
): Promise<PartnerTelegramBotConfig> {
  return apiRequest("/api/v1/partner-telegram/bot/settings", {
    method: "PATCH",
    token,
    body,
  });
}

export async function fetchPartnerTelegramAccounts(token: string): Promise<PartnerTelegramAccount[]> {
  return apiRequest("/api/v1/partner-telegram/accounts", { token });
}

export type PartnerTelegramImportFieldOption = {
  id: string;
  label: string;
  kind: "standard" | "custom" | string;
};

export type PartnerTelegramImportFieldsResponse = {
  fields: PartnerTelegramImportFieldOption[];
};

export type PartnerTelegramImportFromFieldResponse = {
  created: number;
  already_imported: number;
  skipped_empty: number;
  skipped_invalid: number;
  skipped_duplicate: number;
  skipped_partner_linked: number;
  total_partners: number;
};

export async function fetchPartnerTelegramImportFields(
  token: string,
): Promise<PartnerTelegramImportFieldsResponse> {
  return apiRequest("/api/v1/partner-telegram/accounts/import-fields", { token });
}

export async function importPartnerTelegramAccountsFromField(
  token: string,
  fieldId: string,
): Promise<PartnerTelegramImportFromFieldResponse> {
  return apiRequest("/api/v1/partner-telegram/accounts/import-from-field", {
    method: "POST",
    token,
    body: { field_id: fieldId },
  });
}

export async function assignPartnerTelegramAccount(
  token: string,
  accountId: number,
  regosPartnerId: number | null,
): Promise<PartnerTelegramAccount> {
  return apiRequest(`/api/v1/partner-telegram/accounts/${accountId}`, {
    method: "PATCH",
    token,
    body: { regos_partner_id: regosPartnerId },
  });
}

export async function updatePartnerTelegramAccount(
  token: string,
  accountId: number,
  body: {
    warehouse_id?: number | null;
    price_type_id?: number | null;
    page_overrides?: Partial<Record<PartnerPortalPageKey, boolean>>;
  },
): Promise<PartnerTelegramAccount> {
  return apiRequest(`/api/v1/partner-telegram/accounts/${accountId}`, {
    method: "PATCH",
    token,
    body,
  });
}

export async function authenticatePartnerWebApp(
  publicKey: string,
  initData: string,
): Promise<{ access_token: string; account: PartnerTelegramAccount }> {
  return apiRequest("/api/v1/partner-telegram/webapp/auth", {
    method: "POST",
    body: { public_key: publicKey, init_data: initData },
  });
}

export async function loginPartnerPortal(
  publicKey: string,
  phone: string,
  password: string,
): Promise<{ access_token: string; account: PartnerTelegramAccount }> {
  return apiRequest("/api/v1/partner-telegram/webapp/login", {
    method: "POST",
    body: { public_key: publicKey, phone, password },
  });
}

export async function requestPartnerPasswordCode(publicKey: string, phone: string): Promise<{ message: string }> {
  return apiRequest("/api/v1/partner-telegram/webapp/password/request", {
    method: "POST",
    body: { public_key: publicKey, phone },
  });
}

export async function confirmPartnerPassword(body: {
  publicKey: string;
  phone: string;
  code: string;
  password: string;
}): Promise<{ access_token: string; account: PartnerTelegramAccount }> {
  return apiRequest("/api/v1/partner-telegram/webapp/password/confirm", {
    method: "POST",
    body: {
      public_key: body.publicKey,
      phone: body.phone,
      code: body.code,
      password: body.password,
    },
  });
}

export async function fetchPartnerMe(token: string): Promise<PartnerTelegramAccount> {
  return apiRequest("/api/v1/partner-telegram/webapp/me", { token });
}

export async function fetchPartnerCatalogOptions(token: string): Promise<PartnerCatalogOptions> {
  return apiRequest("/api/v1/partner-telegram/webapp/catalog-options", { token });
}

export async function fetchPartnerProducts(
  token: string,
  query: { offset?: number; search?: string; groupId?: number | null; filterType?: string; warehouseId?: number | null },
): Promise<PartnerCatalogResponse> {
  const params = new URLSearchParams();
  params.set("offset", String(query.offset ?? 0));
  params.set("limit", "20");
  if (query.search?.trim()) params.set("search", query.search.trim());
  if (query.groupId) params.set("group_id", String(query.groupId));
  if (query.filterType) params.set("filter_type", query.filterType);
  if (query.warehouseId) params.set("warehouse_id", String(query.warehouseId));
  return apiRequest(`/api/v1/partner-telegram/webapp/products?${params}`, { token });
}

export async function fetchPartnerProductGroups(
  token: string,
): Promise<{ groups: PartnerProductGroup[] }> {
  return apiRequest("/api/v1/partner-telegram/webapp/product-groups", { token });
}

export async function createPartnerOrder(
  token: string,
  body: {
    is_takeaway: boolean;
    address: string;
    phone: string;
    warehouse_id?: number | null;
    items: { product_id: number; quantity: number }[];
  },
): Promise<{ order_id: number; code: string | null }> {
  return apiRequest("/api/v1/partner-telegram/webapp/orders", {
    method: "POST",
    token,
    body,
  });
}

export async function fetchPartnerOrders(
  token: string,
  startDate = "",
  endDate = "",
): Promise<{ orders: PartnerDocumentSummary[] }> {
  const params = new URLSearchParams();
  if (startDate) params.set("start_date", startDate);
  if (endDate) params.set("end_date", endDate);
  const query = params.toString();
  return apiRequest(`/api/v1/partner-telegram/webapp/orders${query ? `?${query}` : ""}`, { token });
}

export async function fetchPartnerOrder(
  token: string,
  orderId: number,
): Promise<{ order: PartnerDocumentSummary; operations: PartnerDocumentLine[] }> {
  return apiRequest(`/api/v1/partner-telegram/webapp/orders/${orderId}`, { token });
}

export async function fetchPartnerDocuments(
  token: string,
  kind: string,
  startDate: string,
  endDate: string,
): Promise<{ documents: PartnerDocumentSummary[] }> {
  const params = new URLSearchParams();
  if (startDate) params.set("start_date", startDate);
  if (endDate) params.set("end_date", endDate);
  return apiRequest(`/api/v1/partner-telegram/webapp/documents/${kind}?${params}`, { token });
}

export async function fetchPartnerDocument(
  token: string,
  kind: string,
  documentId: number,
): Promise<{ document: PartnerDocumentSummary; operations: PartnerDocumentLine[] }> {
  return apiRequest(`/api/v1/partner-telegram/webapp/documents/${kind}/${documentId}`, { token });
}

export async function fetchPartnerPayments(
  token: string,
  startDate: string,
  endDate: string,
): Promise<{ payments: PartnerPayment[] }> {
  const params = new URLSearchParams();
  if (startDate) params.set("start_date", startDate);
  if (endDate) params.set("end_date", endDate);
  return apiRequest(`/api/v1/partner-telegram/webapp/payments?${params}`, { token });
}

export async function fetchPartnerReconciliation(
  token: string,
  startDate: string,
  endDate: string,
): Promise<{ rows: PartnerBalanceRow[] }> {
  const params = new URLSearchParams();
  params.set("start_date", startDate);
  params.set("end_date", endDate);
  return apiRequest(`/api/v1/partner-telegram/webapp/reconciliation?${params}`, { token });
}

export type PartnerDashboardTotals = {
  shipments: number;
  shipments_count: number;
  shipment_returns: number;
  shipment_returns_count: number;
  purchases: number;
  purchases_count: number;
  purchase_returns: number;
  purchase_returns_count: number;
  orders_count: number;
  orders_amount: number;
  payments_in: number;
  payments_in_count: number;
  payments_out: number;
  payments_out_count: number;
  net_debt: number;
};

export type PartnerDashboardDay = {
  day: string;
  shipments: number;
  shipment_returns: number;
  purchases: number;
  purchase_returns: number;
  payments_in: number;
  payments_out: number;
};

export type PartnerDashboardDebtCurrency = {
  currency_code: string | null;
  amount: number;
};

export type PartnerDashboardSummary = {
  period: { start_date: string; end_date: string };
  totals: PartnerDashboardTotals;
  days: PartnerDashboardDay[];
  debt_by_currency: PartnerDashboardDebtCurrency[];
};

export async function fetchPartnerDashboard(
  token: string,
  startDate: string,
  endDate: string,
): Promise<PartnerDashboardSummary> {
  const params = new URLSearchParams();
  if (startDate) params.set("start_date", startDate);
  params.set("end_date", endDate);
  return apiRequest(`/api/v1/partner-telegram/webapp/dashboard?${params}`, { token });
}

export type PartnerDashboardProductMode = "purchases" | "shipments";

export type PartnerDashboardProductRow = {
  item_id: number;
  code: string;
  name: string;
  category: string;
  average_price: number;
  sold_quantity: number;
  sold_total: number;
  refund_quantity: number;
  refund_total: number;
  net_quantity: number;
  net_total: number;
};

export type PartnerDashboardProductTotals = {
  sold_quantity: number;
  sold_total: number;
  refund_quantity: number;
  refund_total: number;
  net_quantity: number;
  net_total: number;
};

export type PartnerDashboardProductsPage = {
  mode: PartnerDashboardProductMode;
  products: PartnerDashboardProductRow[];
  totals: PartnerDashboardProductTotals;
  total: number;
};

export async function fetchPartnerDashboardProducts(
  token: string,
  mode: PartnerDashboardProductMode,
  startDate: string,
  endDate: string,
): Promise<PartnerDashboardProductsPage> {
  const params = new URLSearchParams();
  params.set("mode", mode);
  if (startDate) params.set("start_date", startDate);
  params.set("end_date", endDate);
  return apiRequest(`/api/v1/partner-telegram/webapp/dashboard/products?${params}`, { token });
}

export async function sendPartnerExcelToTelegram(
  token: string,
  file: Blob,
  filename: string,
  caption?: string,
): Promise<{ ok: boolean; filename: string }> {
  const form = new FormData();
  form.append("file", file, filename);
  form.append("filename", filename);
  if (caption) form.append("caption", caption);
  return apiUpload("/api/v1/partner-telegram/webapp/send-excel", form, { token });
}
