import { describe, expect, it } from "vitest";
import {
  normalizeSellContextRecord,
  validateSellContextRecord,
} from "@/lib/sell-context-db";

describe("sell-context-db", () => {
  it("normalizes persisted sell context ids", () => {
    expect(
      normalizeSellContextRecord({
        warehouseId: 11,
        priceTypeId: 22,
        partnerId: 33,
      }),
    ).toEqual({
      warehouseId: 11,
      priceTypeId: 22,
      partnerId: 33,
    });
  });

  it("drops invalid persisted ids during validation", () => {
    expect(
      validateSellContextRecord(
        {
          warehouseId: 11,
          priceTypeId: 99,
          partnerId: 33,
        },
        {
          warehouses: [{ id: 11, name: "Main" }],
          price_types: [{ id: 22, name: "Retail" }],
          partners: [{ id: 33, name: "Walk-in" }],
          payment_categories: [],
          refund_payment_categories: [],
          attached_users: [],
        },
        true,
      ),
    ).toEqual({
      warehouseId: 11,
      priceTypeId: null,
      partnerId: 33,
    });
  });
});
