import { describe, expect, it } from "vitest";
import { formatAmount } from "./partner-format";

describe("formatAmount", () => {
  it("groups thousands and keeps only meaningful decimals", () => {
    expect(formatAmount(23456.23)).toBe("23 456.23");
    expect(formatAmount(23456)).toBe("23 456");
    expect(formatAmount(23456.0)).toBe("23 456");
    expect(formatAmount(23456.5)).toBe("23 456.5");
    expect(formatAmount(23456.346)).toBe("23 456.35");
  });
});
