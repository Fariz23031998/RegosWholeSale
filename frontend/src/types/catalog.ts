export type Product = {
  id: string;
  regos_item_id?: number;
  group_id?: number | null;
  name: string;
  price: number;
  category: string;
  stock: number;
  image: string;
  sku: string;
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
