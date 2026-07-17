import { describe, expect, it } from "vitest";
import { mergeReferenceOptionsCache } from "@/lib/reference-options-db";

describe("reference-options-db", () => {
  it("merges partial reference option patches onto existing cache", () => {
    expect(
      mergeReferenceOptionsCache(
        {
          warehouses: [{ id: 1, name: "Main" }],
          price_types: [{ id: 2, name: "Retail" }],
          partners: [{ id: 3, name: "Walk-in" }],
          fetchedAt: 100,
        },
        {
          partners: [{ id: 4, name: "Updated partner" }],
        },
      ),
    ).toEqual({
      warehouses: [{ id: 1, name: "Main" }],
      price_types: [{ id: 2, name: "Retail" }],
      partners: [{ id: 4, name: "Updated partner" }],
      fetchedAt: expect.any(Number),
    });
  });

  it("keeps payment categories and attached users across partial patches", () => {
    expect(
      mergeReferenceOptionsCache(
        {
          warehouses: [{ id: 1, name: "Main" }],
          price_types: [],
          partners: [],
          payment_categories: [{ id: 5, name: "Sales income" }],
          refund_payment_categories: [{ id: 6, name: "Refunds" }],
          attached_users: [{ id: 7, name: "Cashier" }],
          fetchedAt: 100,
        },
        {
          warehouses: [{ id: 2, name: "Secondary" }],
        },
      ),
    ).toEqual({
      warehouses: [{ id: 2, name: "Secondary" }],
      price_types: [],
      partners: [],
      payment_categories: [{ id: 5, name: "Sales income" }],
      refund_payment_categories: [{ id: 6, name: "Refunds" }],
      attached_users: [{ id: 7, name: "Cashier" }],
      fetchedAt: expect.any(Number),
    });
  });

  it("creates a full cache record from an empty base", () => {
    expect(
      mergeReferenceOptionsCache(null, {
        warehouses: [{ id: 10, name: "Warehouse" }],
        price_types: [],
        partners: [],
      }),
    ).toEqual({
      warehouses: [{ id: 10, name: "Warehouse" }],
      price_types: [],
      partners: [],
      fetchedAt: expect.any(Number),
    });
  });
});
