import { describe, expect, it } from "vitest";
import { parseDecimalInput } from "@/lib/parse-decimal-input";

describe("parseDecimalInput", () => {
  it("parses period decimals", () => {
    expect(parseDecimalInput("1.5")).toBe(1.5);
    expect(parseDecimalInput("0.25")).toBe(0.25);
  });

  it("parses comma decimals", () => {
    expect(parseDecimalInput("1,5")).toBe(1.5);
    expect(parseDecimalInput("0,25")).toBe(0.25);
  });

  it("strips surrounding and internal spaces", () => {
    expect(parseDecimalInput("  12,5  ")).toBe(12.5);
    expect(parseDecimalInput("1 000")).toBe(1000);
  });

  it("returns null for empty input", () => {
    expect(parseDecimalInput("")).toBeNull();
    expect(parseDecimalInput("   ")).toBeNull();
  });

  it("returns null for invalid input", () => {
    expect(parseDecimalInput("abc")).toBeNull();
    expect(parseDecimalInput("1.2.3")).toBeNull();
  });
});
