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

export type VatCalculationType = "No" | "Exclude" | "Include";

export type RegosDefaults = {
  warehouse: RegosDefaultOption | null;
  price_type: RegosDefaultOption | null;
  partner: RegosDefaultOption | null;
  currency: RegosCurrencyOption | null;
  firm: RegosDefaultOption | null;
  payment_category: RegosDefaultOption | null;
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
  attached_user_id?: number | null;
  vat_calculation_type?: VatCalculationType | null;
  zero_quantity?: boolean;
  zero_price?: boolean;
};

export type RegosReferenceOptionsResponse = {
  warehouses: RegosDefaultOption[];
  price_types: RegosDefaultOption[];
  partners: RegosDefaultOption[];
  payment_categories: RegosDefaultOption[];
  attached_users: RegosDefaultOption[];
};

export type RegosTokenConfig = {
  configured: boolean;
  token: string;
  is_replicable: boolean;
  webhook_url: string | null;
};

export type RegosTokenUpsertRequest = {
  token: string;
  is_replicable: boolean;
};

export type RegosTokenMessage = {
  message: string;
  is_replicable?: boolean | null;
};

export type PosSettings = {
  allow_out_of_stock: boolean;
  tendered_quick_amounts: number[];
  auto_open_qty_keypad: boolean;
};

export type PosSettingsResponse = {
  settings: PosSettings;
};

export type PosSettingsPatchRequest = {
  allow_out_of_stock?: boolean;
  tendered_quick_amounts?: number[];
  auto_open_qty_keypad?: boolean;
};

export type DefaultCategorySetting = {
  mode: "all" | "featured" | "group";
  group_id: number | null;
};

export type UserPosSettings = {
  allow_out_of_stock: boolean;
  tendered_quick_amounts: number[];
  default_category: DefaultCategorySetting;
  auto_open_qty_keypad: boolean;
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

export const VAT_CALCULATION_TYPE_OPTIONS: {
  value: VatCalculationType;
  label: string;
}[] = [
  { value: "No", label: "No VAT" },
  { value: "Exclude", label: "VAT included in amount" },
  { value: "Include", label: "VAT on top of amount" },
];
