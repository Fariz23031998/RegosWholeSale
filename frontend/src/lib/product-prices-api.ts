import { apiRequest } from "@/lib/api";

export type PriceChangeLine = {
  item_id: number;
  base_value: number;
  new_value: number;
};

export async function setProductPrices(
  token: string,
  body: { price_type_id: number; lines: PriceChangeLine[] },
): Promise<{ document_id: number }> {
  return apiRequest("/api/v1/regos/products/prices", {
    token,
    method: "POST",
    body,
  });
}
