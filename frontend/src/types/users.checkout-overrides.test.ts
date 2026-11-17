import { describe, expect, it } from "vitest";
import { filterCheckoutOverrides } from "@/types/users";

describe("filterCheckoutOverrides", () => {
  it("includes currency_id only when permitted", () => {
    const overrides = {
      warehouse_id: 1,
      price_type_id: 2,
      partner_id: 3,
      currency_id: 4,
    };

    expect(
      filterCheckoutOverrides(overrides, {
        canChangeWarehouse: false,
        canChangePriceType: false,
        canChangePartner: false,
        canChangeCurrency: true,
      }),
    ).toEqual({ currency_id: 4 });

    expect(
      filterCheckoutOverrides(overrides, {
        canChangeWarehouse: true,
        canChangePriceType: true,
        canChangePartner: true,
        canChangeCurrency: false,
      }),
    ).toEqual({
      warehouse_id: 1,
      price_type_id: 2,
      partner_id: 3,
    });
  });
});
