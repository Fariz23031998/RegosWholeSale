export type RegosUnit = {
  id: number;
  name: string;
  type: "pcs" | "non_pcs" | null;
};

export type RegosTaxVat = {
  id: number;
  name: string;
  value: number | null;
  enabled: boolean;
};

export type RegosItemDetail = {
  id: number;
  name: string;
  fullname: string | null;
  description: string | null;
  articul: string | null;
  code: string | null;
  barcode: string | null;
  barcodes: string[];
  icps: string | null;
  package_code: string | null;
  is_labeled: boolean;
  group_id: number;
  group_name: string | null;
  unit_id: number;
  unit_name: string | null;
  vat_id: number;
  vat_name: string | null;
  vat_value: number | null;
  type: "Item" | "Service";
};

export type ItemCreateRequest = {
  name: string;
  group_id: number;
  unit_id: number;
  vat_id: number;
  type?: "Item" | "Service";
  fullname?: string | null;
  description?: string | null;
  articul?: string | null;
  code?: number | null;
  barcode?: string | null;
  barcodes?: string[] | null;
  icps?: string | null;
  package_code?: string | null;
  is_labeled?: boolean | null;
};

export type ItemUpdateRequest = {
  name?: string | null;
  group_id?: number | null;
  unit_id?: number | null;
  vat_id?: number | null;
  type?: "Item" | "Service" | null;
  fullname?: string | null;
  description?: string | null;
  articul?: string | null;
  code?: number | null;
  barcode?: string | null;
  barcodes?: string[] | null;
  icps?: string | null;
  package_code?: string | null;
  is_labeled?: boolean | null;
};

export type ItemFormValues = {
  name: string;
  group_id: number;
  unit_id: number;
  vat_id: number;
  articul: string;
  barcodes: string[];
  icps: string;
  package_code: string;
  is_labeled: boolean;
  description: string;
};

export const EMPTY_ITEM_FORM: ItemFormValues = {
  name: "",
  group_id: 0,
  unit_id: 0,
  vat_id: 0,
  articul: "",
  barcodes: [],
  icps: "",
  package_code: "",
  is_labeled: false,
  description: "",
};
