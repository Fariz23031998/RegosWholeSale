export type ReceiptOperationItemNameRef = {
  name: string | null;
};

export type ReceiptOperationItemVat = {
  name: string | null;
  value: number | null;
};

export type ReceiptOperationItem = {
  fullname: string | null;
  description: string | null;
  articul: string | null;
  color: ReceiptOperationItemNameRef;
  size: ReceiptOperationItemNameRef;
  producer: ReceiptOperationItemNameRef;
  country: ReceiptOperationItemNameRef;
  icps: string | null;
  package_code: string | null;
  department: ReceiptOperationItemNameRef;
  vat: ReceiptOperationItemVat;
  base_barcode: string | null;
};

export const EMPTY_RECEIPT_OPERATION_ITEM: ReceiptOperationItem = {
  fullname: null,
  description: null,
  articul: null,
  color: { name: null },
  size: { name: null },
  producer: { name: null },
  country: { name: null },
  icps: null,
  package_code: null,
  department: { name: null },
  vat: { name: null, value: null },
  base_barcode: null,
};

type CatalogProductLike = {
  name?: string;
  sku?: string;
  barcode?: string;
  category?: string;
};

export function receiptOperationItemFromCatalogProduct(
  product?: CatalogProductLike | null,
): ReceiptOperationItem {
  if (!product) {
    return { ...EMPTY_RECEIPT_OPERATION_ITEM };
  }

  return {
    ...EMPTY_RECEIPT_OPERATION_ITEM,
    fullname: product.name?.trim() || null,
    articul: product.sku?.trim() || null,
    base_barcode: product.barcode?.trim() || null,
    department: { name: product.category?.trim() || null },
  };
}

export type ReceiptOperationTemplateFields = {
  item_fullname: string | null;
  item_description: string | null;
  item_articul: string | null;
  item_color_name: string | null;
  item_size_name: string | null;
  item_producer_name: string | null;
  item_country_name: string | null;
  item_icps: string | null;
  item_package_code: string | null;
  item_department_name: string | null;
  item_vat_name: string | null;
  item_vat_value: number | null;
  item_base_barcode: string | null;
};

export function receiptOperationTemplateFields(
  item: ReceiptOperationItem,
): ReceiptOperationTemplateFields {
  return {
    item_fullname: item.fullname,
    item_description: item.description,
    item_articul: item.articul,
    item_color_name: item.color.name,
    item_size_name: item.size.name,
    item_producer_name: item.producer.name,
    item_country_name: item.country.name,
    item_icps: item.icps,
    item_package_code: item.package_code,
    item_department_name: item.department.name,
    item_vat_name: item.vat.name,
    item_vat_value: item.vat.value,
    item_base_barcode: item.base_barcode,
  };
}

export function expandOperationTemplateFields<T extends { item?: ReceiptOperationItem | null }>(
  line: T,
): T & ReceiptOperationTemplateFields {
  const item = normalizeReceiptOperationItem(line.item);
  return {
    ...line,
    item,
    ...receiptOperationTemplateFields(item),
  };
}

export function normalizeReceiptOperationItem(
  item?: Partial<ReceiptOperationItem> | null,
): ReceiptOperationItem {
  if (!item) {
    return { ...EMPTY_RECEIPT_OPERATION_ITEM };
  }

  return {
    fullname: item.fullname ?? null,
    description: item.description ?? null,
    articul: item.articul ?? null,
    color: { name: item.color?.name ?? null },
    size: { name: item.size?.name ?? null },
    producer: { name: item.producer?.name ?? null },
    country: { name: item.country?.name ?? null },
    icps: item.icps ?? null,
    package_code: item.package_code ?? null,
    department: { name: item.department?.name ?? null },
    vat: {
      name: item.vat?.name ?? null,
      value:
        typeof item.vat?.value === "number" && Number.isFinite(item.vat.value)
          ? item.vat.value
          : null,
    },
    base_barcode: item.base_barcode ?? null,
  };
}
