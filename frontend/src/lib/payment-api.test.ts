import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPaymentTypes, invalidatePaymentTypesCache } from "./payment-api";

vi.mock("@/lib/api", () => ({
  apiRequest: vi.fn(),
}));

import { apiRequest } from "@/lib/api";

describe("fetchPaymentTypes", () => {
  afterEach(() => {
    vi.clearAllMocks();
    invalidatePaymentTypesCache();
  });

  it("dedupes concurrent requests for the same token", async () => {
    vi.mocked(apiRequest).mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                payment_types: [{ id: 1, name: "Cash", is_cash: true, allows_debt: false, image_url: "" }],
              }),
            10,
          );
        }),
    );

    const [first, second] = await Promise.all([
      fetchPaymentTypes("token-a"),
      fetchPaymentTypes("token-a"),
    ]);

    expect(first).toEqual(second);
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });
});
