export type RegosCurrencyOption = {
  id: number;
  name: string;
  code_chr?: string | null;
  exchange_rate?: number | null;
};

export type RegosDefaultOption = {
  id: number;
  name: string;
};

export type RegosPriceTypeOption = RegosDefaultOption & {
  currency?: RegosCurrencyOption | null;
};

export type VatCalculationType = "No" | "Exclude" | "Include";

export type RegosDefaults = {
  warehouse: RegosDefaultOption | null;
  price_type: RegosDefaultOption | null;
  partner: RegosDefaultOption | null;
  currency: RegosCurrencyOption | null;
  firm: RegosDefaultOption | null;
  payment_category: RegosDefaultOption | null;
  refund_payment_category: RegosDefaultOption | null;
  attached_user: RegosDefaultOption | null;
  vat_calculation_type: VatCalculationType;
  zero_quantity: boolean;
  zero_price: boolean;
};

export type RegosDefaultsResponse = {
  defaults: RegosDefaults;
};

export type RegosDefaultsPatchRequest = {
  warehouse_id?: number | null;
  price_type_id?: number | null;
  partner_id?: number | null;
  payment_category_id?: number | null;
  refund_payment_category_id?: number | null;
  attached_user_id?: number | null;
  vat_calculation_type?: VatCalculationType | null;
  zero_quantity?: boolean;
  zero_price?: boolean;
};

export type RegosReferenceOptionsResponse = {
  warehouses: RegosDefaultOption[];
  price_types: RegosPriceTypeOption[];
  partners: RegosDefaultOption[];
  payment_categories: RegosDefaultOption[];
  refund_payment_categories: RegosDefaultOption[];
  attached_users: RegosDefaultOption[];
  firms: RegosDefaultOption[];
};

export type RegosTokenConfig = {
  configured: boolean;
  token_masked: string;
  is_replicable: boolean;
  webhook_url: string | null;
};

export type RegosTokenUpsertRequest = {
  token?: string | null;
  is_replicable: boolean;
};

export type RegosTokenMessage = {
  message: string;
  is_replicable?: boolean | null;
};

export type RegosCustomField = {
  id: number;
  key: string;
  name: string;
  entity_type: string;
  data_type: string;
};

export type RegosDocPaymentSaleIdFieldResponse = {
  configured: boolean;
  field: RegosCustomField | null;
  created?: boolean;
};

export type PaymentLinkingMode = "sale_id_field" | "document_description";

export type RegosPaymentLinkingResponse = {
  mode: PaymentLinkingMode;
  sale_id_field_configured: boolean;
  sale_id_field: RegosCustomField | null;
};

export type RegosPaymentLinkingPatchRequest = {
  mode: PaymentLinkingMode;
};

export type CrossCurrencyPaymentMode = "payment_currency" | "sale_currency_transfer";
export type PostponeDocumentType = "doc_wholesale" | "doc_order_from_partner";

export type DefaultCategorySetting = {
  mode: "all" | "featured" | "group";
  group_id: number | null;
};

export type PosSettings = {
  allow_out_of_stock: boolean;
  tendered_quick_amounts: number[];
  default_category: DefaultCategorySetting;
  auto_open_qty_keypad: boolean;
  cross_currency_payment_mode: CrossCurrencyPaymentMode;
  internal_barcode_weight_prefix: string;
  internal_barcode_piece_prefix: string;
  postpone_document_type: PostponeDocumentType;
  postpone_order_booked: boolean;
};

export type PosSettingsResponse = {
  settings: PosSettings;
};

export type PosSettingsPatchRequest = {
  allow_out_of_stock?: boolean;
  tendered_quick_amounts?: number[];
  default_category?: DefaultCategorySetting;
  auto_open_qty_keypad?: boolean;
  cross_currency_payment_mode?: CrossCurrencyPaymentMode;
  internal_barcode_weight_prefix?: string;
  internal_barcode_piece_prefix?: string;
  postpone_document_type?: PostponeDocumentType;
  postpone_order_booked?: boolean;
};

export type UserPosSettings = {
  allow_out_of_stock: boolean;
  tendered_quick_amounts: number[];
  default_category: DefaultCategorySetting;
  auto_open_qty_keypad: boolean;
  cross_currency_payment_mode: CrossCurrencyPaymentMode;
  internal_barcode_weight_prefix: string;
  internal_barcode_piece_prefix: string;
  postpone_document_type: PostponeDocumentType;
  postpone_order_booked: boolean;
};

export type UserPosSettingsResponse = {
  settings: UserPosSettings;
};

export type UserPosSettingsPatchRequest = {
  allow_out_of_stock?: boolean;
  tendered_quick_amounts?: number[];
  default_category?: DefaultCategorySetting;
  auto_open_qty_keypad?: boolean;
};

type TranslateFn = (
  key: string,
  fallback?: string,
  params?: Record<string, string | number>,
) => string;

export function getVatCalculationTypeOptions(t: TranslateFn): {
  value: VatCalculationType;
  label: string;
}[] {
  return [
    { value: "No", label: t("settings.vat.no", "No VAT") },
    { value: "Exclude", label: t("settings.vat.exclude", "VAT included in amount") },
    { value: "Include", label: t("settings.vat.include", "VAT on top of amount") },
  ];
}
