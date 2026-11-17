export type Product = {
  id: string;
  regos_item_id?: number;
  group_id?: number | null;
  name: string;
  price: number;
  last_purchase_cost?: number | null;
  category: string;
  stock: number;
  image: string;
  sku: string;
  articul?: string;
  barcode?: string;
  barcode_list?: string;
  code?: string;
  unit_id?: number | null;
  unit_name?: string;
  unit_type?: number | null;
  secondary_unit_id?: number | null;
  secondary_unit_name?: string | null;
  secondary_unit_type?: number | null;
  conversion_factor?: number | null;
  secondary_price?: number | null;
  secondary_price_type_id?: number | null;
};

export type CatalogProductsResponse = {
  products: Product[];
  next_offset: number;
  total: number;
};

export type ProductGroup = {
  id: number;
  parent_id: number | null;
  name: string;
  path: string;
  child_count: number;
};

export type CatalogGroupsResponse = {
  groups: ProductGroup[];
};
