import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPaymentTypes } from "./payment-service";

vi.mock("@/lib/payment-api", () => ({
  fetchPaymentTypes: vi.fn(),
  setCachedPaymentTypes: vi.fn(),
}));

vi.mock("@/lib/payment-types-db", () => ({
  loadCachedPaymentTypes: vi.fn(),
  saveCachedPaymentTypes: vi.fn(),
}));

import { fetchPaymentTypes, setCachedPaymentTypes } from "@/lib/payment-api";
import { loadCachedPaymentTypes, saveCachedPaymentTypes } from "@/lib/payment-types-db";

const sampleTypes = [
  { id: 1, name: "Cash", is_cash: true, allows_debt: false, image_url: "" },
  { id: 2, name: "Card", is_cash: false, allows_debt: false, image_url: "" },
];

describe("loadPaymentTypes", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns cached payment types immediately and revalidates in background", async () => {
    vi.mocked(loadCachedPaymentTypes).mockResolvedValue({
      payment_types: sampleTypes,
      fetchedAt: Date.now(),
    });
    vi.mocked(fetchPaymentTypes).mockResolvedValue({ payment_types: sampleTypes });
    vi.mocked(saveCachedPaymentTypes).mockResolvedValue(undefined);

    const result = await loadPaymentTypes("token-a", 42);

    expect(result.payment_types).toEqual(sampleTypes);
    expect(setCachedPaymentTypes).toHaveBeenCalledWith("token-a", { payment_types: sampleTypes });

    await vi.waitFor(() => {
      expect(fetchPaymentTypes).toHaveBeenCalledWith("token-a", { force: true });
    });
    expect(saveCachedPaymentTypes).toHaveBeenCalledWith(42, sampleTypes);
  });

  it("dedupes concurrent loads for the same company", async () => {
    vi.mocked(loadCachedPaymentTypes).mockResolvedValue(null);
    vi.mocked(saveCachedPaymentTypes).mockResolvedValue(undefined);
    vi.mocked(fetchPaymentTypes).mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ payment_types: sampleTypes }), 10);
        }),
    );

    const [first, second] = await Promise.all([
      loadPaymentTypes("token-a", 7),
      loadPaymentTypes("token-a", 7),
    ]);

    expect(first).toEqual(second);
    expect(fetchPaymentTypes).toHaveBeenCalledTimes(1);
    expect(saveCachedPaymentTypes).toHaveBeenCalledWith(7, sampleTypes);
  });

  it("force option bypasses cache and fetches from API", async () => {
    vi.mocked(loadCachedPaymentTypes).mockResolvedValue({
      payment_types: sampleTypes,
      fetchedAt: Date.now(),
    });
    vi.mocked(saveCachedPaymentTypes).mockResolvedValue(undefined);
    vi.mocked(fetchPaymentTypes).mockResolvedValue({
      payment_types: [{ ...sampleTypes[0], name: "Updated Cash" }],
    });

    const result = await loadPaymentTypes("token-a", 42, { force: true });

    expect(result.payment_types[0]?.name).toBe("Updated Cash");
    expect(fetchPaymentTypes).toHaveBeenCalledWith("token-a", { force: true });
    expect(saveCachedPaymentTypes).toHaveBeenCalledWith(42, result.payment_types);
  });
});
