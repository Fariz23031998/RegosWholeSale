export type RegosDefaultOption = {
  id: number;
  name: string;
};

export type RegosDefaults = {
  warehouse: RegosDefaultOption | null;
  price_type: RegosDefaultOption | null;
  partner: RegosDefaultOption | null;
  currency: RegosDefaultOption | null;
  firm: RegosDefaultOption | null;
  payment_category: RegosDefaultOption | null;
  attached_user: RegosDefaultOption | null;
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
};

export type PosSettingsResponse = {
  settings: PosSettings;
};

export type PosSettingsPatchRequest = {
  allow_out_of_stock?: boolean;
  tendered_quick_amounts?: number[];
};

export type DefaultCategorySetting = {
  mode: "all" | "featured" | "group";
  group_id: number | null;
};

export type UserPosSettings = {
  default_category: DefaultCategorySetting;
};

export type UserPosSettingsResponse = {
  settings: UserPosSettings;
};

export type UserPosSettingsPatchRequest = {
  default_category?: DefaultCategorySetting;
};
