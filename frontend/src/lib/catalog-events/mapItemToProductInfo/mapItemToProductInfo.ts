import type { Product } from "@/types/catalog";

export function mapItemToProductInfo(item: any): Partial<Product> {
  const regosItemId = item.id;
  const name = String(item.name || item.fullname || `#${regosItemId}`);
  const category = String(item.group?.name || item.department?.name || "Other");
  const barcode = item.base_barcode != null ? String(item.base_barcode) : "";
  const barcode_list = item.barcode_list != null ? String(item.barcode_list) : barcode;
  const code = item.code != null ? String(item.code) : "";
  const articul = item.articul != null ? String(item.articul) : "";
  const unit_name = item.unit?.name != null ? String(item.unit.name) : "";
  
  let unit_type: number | null = null;
  if (item.unit) {
    if (item.unit.type === "pcs") {
      unit_type = 1;
    } else if (typeof item.unit.type === "number") {
      unit_type = item.unit.type;
    }
  }

  const sku = String(articul || barcode || code || regosItemId);
  const image = item.image_url != null ? String(item.image_url) : "";
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
    barcode_list,
    code,
    unit_name,
    unit_type,
  };
}
