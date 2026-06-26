import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import { extractWholesaleDocIdFromError } from "@/lib/checkout-error";

describe("extractWholesaleDocIdFromError", () => {
  it("extracts the id from backend checkout failure messages", () => {
    const err = new ApiError(
      400,
      "Perform failed (wholesale_doc_id=1001)",
      "REGOS_API_ERROR",
    );
    expect(extractWholesaleDocIdFromError(err)).toBe(1001);
  });

  it("returns null when the error has no wholesale document id", () => {
    expect(extractWholesaleDocIdFromError(new Error("Checkout failed"))).toBeNull();
    expect(extractWholesaleDocIdFromError(null)).toBeNull();
  });
});
