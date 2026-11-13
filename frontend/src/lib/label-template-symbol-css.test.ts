import { describe, expect, it } from "vitest";
import {
  DEFAULT_BARCODE_HEIGHT_MM,
  DEFAULT_BARCODE_WIDTH_PERCENT,
  DEFAULT_QR_SIZE_MM,
  parseBarcodeHeightMm,
  parseBarcodeWidthPercent,
  parseQrSizeMm,
  setBarcodeHeightMm,
  setBarcodeWidthPercent,
  setQrSizeMm,
} from "./label-template-symbol-css";

describe("label-template-symbol-css", () => {
  it("parses barcode height from height or max-height", () => {
    expect(parseBarcodeHeightMm("img.barcode { height: 12mm; width: 100%; }")).toBe(12);
    expect(parseBarcodeHeightMm("img.barcode { max-height: 13mm; height: auto; }")).toBe(13);
  });

  it("returns barcode default when rule or height is missing", () => {
    expect(parseBarcodeHeightMm("")).toBe(DEFAULT_BARCODE_HEIGHT_MM);
    expect(parseBarcodeHeightMm("img.barcode { width: 100%; }")).toBe(DEFAULT_BARCODE_HEIGHT_MM);
  });

  it("parses barcode width percent from width or max-width", () => {
    expect(parseBarcodeWidthPercent("img.barcode { height: 12mm; width: 80%; }")).toBe(80);
    expect(parseBarcodeWidthPercent("img.barcode { height: auto; max-width: 55%; }")).toBe(55);
    expect(parseBarcodeWidthPercent("")).toBe(DEFAULT_BARCODE_WIDTH_PERCENT);
  });

  it("parses QR size preferring height then width", () => {
    expect(parseQrSizeMm("img.qr { height: 12mm; width: 12mm; }")).toBe(12);
    expect(parseQrSizeMm("img.qr { width: 9mm; }")).toBe(9);
    expect(parseQrSizeMm("")).toBe(DEFAULT_QR_SIZE_MM);
  });

  it("sets independent height with object-fit fill for 1D barcodes", () => {
    const updated = setBarcodeHeightMm(
      "img.barcode { height: auto; max-height: 9mm; width: auto; max-width: 52%; object-fit: contain; }",
      14,
    );
    expect(parseBarcodeHeightMm(updated)).toBe(14);
    expect(parseBarcodeWidthPercent(updated)).toBe(52);
    expect(updated).toMatch(/height:\s*14mm/i);
    expect(updated).toMatch(/width:\s*52%/i);
    expect(updated).toMatch(/object-fit:\s*fill/i);
    expect(updated).not.toMatch(/max-height:\s*\d/i);

    const appended = setBarcodeHeightMm(".name { font-size: 12px; }", 10);
    expect(appended).toMatch(/height:\s*10mm/i);
    expect(appended).toMatch(/width:\s*100%/i);
    expect(appended).toMatch(/object-fit:\s*fill/i);
  });

  it("upserts barcode width percent and keeps height", () => {
    const updated = setBarcodeWidthPercent("img.barcode { height: 12mm; width: 100%; }", 80);
    expect(parseBarcodeWidthPercent(updated)).toBe(80);
    expect(parseBarcodeHeightMm(updated)).toBe(12);
    expect(updated).toMatch(/(?:^|[;{\s])width:\s*80%/i);
    expect(updated).toMatch(/height:\s*12mm/i);
    expect(updated).toMatch(/object-fit:\s*fill/i);
  });

  it("does not confuse width with max-width when reading or writing", () => {
    const css = "img.barcode { height: 9mm; width: 52%; max-width: 100%; object-fit: fill; }";
    expect(parseBarcodeWidthPercent(css)).toBe(52);

    const updated = setBarcodeWidthPercent(css, 70);
    expect(parseBarcodeWidthPercent(updated)).toBe(70);
    expect(updated).toMatch(/(?:^|[;{\s])width:\s*70%/i);
    expect(updated).toMatch(/max-width:\s*100%/i);
  });

  it("upserts QR width and height together", () => {
    const updated = setQrSizeMm(
      `img.qr {
  height: 12mm;
  width: 12mm;
  flex: 0 0 auto;
}`,
      16,
    );
    expect(parseQrSizeMm(updated)).toBe(16);
    expect(updated).toMatch(/height:\s*16mm/i);
    expect(updated).toMatch(/width:\s*16mm/i);

    const appended = setQrSizeMm("", 11);
    expect(appended).toContain("img.qr { height: 11mm; width: 11mm; }");
  });
});
