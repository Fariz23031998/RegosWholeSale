import { describe, expect, it } from "vitest";
import {
  isValidReceiptLogoDataUrl,
  normalizeReceiptTemplateLogos,
  validateReceiptTemplateLogos,
} from "@/lib/receipt-template-logos";

const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("receipt template logos", () => {
  it("accepts valid image data urls", () => {
    expect(isValidReceiptLogoDataUrl(PNG_DATA_URL)).toBe(true);
  });

  it("rejects non-image data urls", () => {
    expect(isValidReceiptLogoDataUrl("data:text/html;base64,PHNjcmlwdD4=")).toBe(false);
  });

  it("normalizes and validates unique logo names", () => {
    const logos = normalizeReceiptTemplateLogos([
      { id: "1", name: "Primary", src: PNG_DATA_URL, max_width: 120 },
      { id: "2", name: "Stamp", src: PNG_DATA_URL, max_width: null },
    ]);
    expect(logos).toHaveLength(2);
    expect(logos[0]?.max_width).toBe(120);
    expect(() => validateReceiptTemplateLogos(logos)).not.toThrow();
    expect(() =>
      validateReceiptTemplateLogos([
        ...logos,
        { id: "3", name: "primary", src: PNG_DATA_URL, max_width: null },
      ]),
    ).toThrow(/Duplicate logo name/i);
  });
});
