import { apiRequest } from "@/lib/api";
import type {
  ItemCreateRequest,
  ItemUpdateRequest,
  RegosItemDetail,
  RegosTaxVat,
  RegosUnit,
} from "@/types/items";

export async function fetchUnits(token: string): Promise<RegosUnit[]> {
  const res = await apiRequest<{ units: RegosUnit[] }>("/api/v1/regos/units", { token });
  return res.units;
}

export async function fetchTaxVats(token: string): Promise<RegosTaxVat[]> {
  const res = await apiRequest<{ tax_vats: RegosTaxVat[] }>("/api/v1/regos/tax-vats", {
    token,
  });
  return res.tax_vats;
}

export async function fetchItem(token: string, itemId: number): Promise<RegosItemDetail> {
  return apiRequest<RegosItemDetail>(`/api/v1/regos/items/${itemId}`, { token });
}

export async function createItem(
  token: string,
  body: ItemCreateRequest,
): Promise<{ id: number }> {
  return apiRequest<{ id: number }>("/api/v1/regos/items", {
    method: "POST",
    token,
    body,
  });
}

export async function updateItem(
  token: string,
  itemId: number,
  body: ItemUpdateRequest,
): Promise<{ row_affected: number }> {
  return apiRequest<{ row_affected: number }>(`/api/v1/regos/items/${itemId}`, {
    method: "PATCH",
    token,
    body,
  });
}

export async function generateEan13(token: string): Promise<{ value: string }> {
  return apiRequest<{ value: string }>("/api/v1/regos/barcodes/ean13", {
    method: "POST",
    token,
  });
}
