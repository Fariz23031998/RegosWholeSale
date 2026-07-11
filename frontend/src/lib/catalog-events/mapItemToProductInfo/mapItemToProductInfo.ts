import type { Product } from "@/types/catalog";

export function mapItemToProductInfo(item: any): Partial<Product> {
  const regosItemId = item.id;
  const name = item.name || item.fullname || `#${regosItemId}`;
  const category = item.group?.name || item.department?.name || "Other";
  const barcode = item.base_barcode || "";
  const code = item.code || "";
  const articul = item.articul || "";
  const unit_name = item.unit?.name || "";
  
  let unit_type: number | null = null;
  if (item.unit) {
    if (item.unit.type === "pcs") {
      unit_type = 1;
    } else if (typeof item.unit.type === "number") {
      unit_type = item.unit.type;
    }
  }

  const sku = articul || barcode || code || String(regosItemId);
  const image = item.image_url || "";
  const group_id = item.group?.id || null;

  return {
    id: String(regosItemId),
    regos_item_id: regosItemId,
    group_id,
    name,
    category,
    image,
    sku,
    articul,
    barcode,
    code,
    unit_name,
    unit_type,
  };
}
