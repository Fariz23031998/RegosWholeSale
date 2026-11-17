import { apiRequest } from "@/lib/api";

export type UnitConversion = {
  id: number;
  main_unit_id: number;
  secondary_unit_id: number;
  conversion_factor: number;
  price_type_id?: number | null;
  main_unit_name?: string | null;
  secondary_unit_name?: string | null;
  secondary_unit_type?: number | null;
};

export async function fetchUnitConversions(
  token: string,
): Promise<UnitConversion[]> {
  const res = await apiRequest<{ conversions: UnitConversion[] }>(
    "/api/v1/unit-conversions",
    { token },
  );
  return res.conversions;
}

export async function upsertUnitConversion(
  token: string,
  body: {
    main_unit_id: number;
    secondary_unit_id: number;
    conversion_factor: number;
    price_type_id?: number | null;
  },
): Promise<UnitConversion> {
  const res = await apiRequest<{ conversion: UnitConversion }>(
    "/api/v1/unit-conversions",
    {
      method: "PUT",
      token,
      body,
    },
  );
  return res.conversion;
}

export async function deleteUnitConversion(
  token: string,
  conversionId: number,
): Promise<UnitConversion[]> {
  const res = await apiRequest<{ conversions: UnitConversion[] }>(
    `/api/v1/unit-conversions/${conversionId}`,
    {
      method: "DELETE",
      token,
    },
  );
  return res.conversions;
}
