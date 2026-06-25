import { describe, expect, it } from "vitest";
import type { WholesaleDocument } from "@/lib/sales-api";
import { filterWholesaleDocuments } from "@/lib/wholesale-document-search";

const sampleDoc = (overrides: Partial<WholesaleDocument> = {}): WholesaleDocument => ({
  id: 42,
  code: "WS-100",
  date: 0,
  partner_id: 1,
  partner_name: "Acme Corp",
  stock_id: 2,
  stock_name: "Main warehouse",
  attached_user_id: 3,
  attached_user_name: "Jane Doe",
  amount: 100,
  performed: true,
  ...overrides,
});

describe("filterWholesaleDocuments", () => {
  it("returns all documents when search is empty", () => {
    const documents = [sampleDoc(), sampleDoc({ id: 43, code: "WS-101" })];
    expect(filterWholesaleDocuments(documents, "")).toEqual(documents);
    expect(filterWholesaleDocuments(documents, "   ")).toEqual(documents);
  });

  it("matches code, partner, warehouse, and attached user", () => {
    const documents = [
      sampleDoc(),
      sampleDoc({ id: 99, code: "WS-200", partner_name: "Other LLC" }),
    ];
    expect(filterWholesaleDocuments(documents, "acme")).toHaveLength(1);
    expect(filterWholesaleDocuments(documents, "main")).toHaveLength(1);
    expect(filterWholesaleDocuments(documents, "jane")).toHaveLength(1);
    expect(filterWholesaleDocuments(documents, "42")).toHaveLength(1);
    expect(filterWholesaleDocuments(documents, "ws-200")).toHaveLength(1);
  });

  it("supports extra fields for returns", () => {
    const documents = [sampleDoc()];
    expect(
      filterWholesaleDocuments(documents, "damaged", (doc) => [
        (doc as { reason?: string }).reason,
      ]),
    ).toHaveLength(0);

    const withReason = [
      sampleDoc({ ...( { reason: "Damaged goods" } as object) }),
    ];
    expect(
      filterWholesaleDocuments(withReason, "damaged", (doc) => [
        (doc as { reason?: string }).reason,
      ]),
    ).toHaveLength(1);
  });
});
