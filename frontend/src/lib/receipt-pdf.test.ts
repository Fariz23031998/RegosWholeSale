import { describe, expect, it, vi, afterEach } from "vitest";
import {
  buildReceiptFilename,
  isMobileSharePlatform,
  trySharePdfFile,
} from "@/lib/receipt-pdf";

describe("buildReceiptFilename", () => {
  it("sanitizes document code and includes date", () => {
    const name = buildReceiptFilename("WS/001#test");
    expect(name).toMatch(/^receipt-WS_001_test-\d{4}-\d{2}-\d{2}\.pdf$/);
  });

  it("falls back when code is empty", () => {
    const name = buildReceiptFilename("!!!");
    expect(name).toMatch(/^receipt-_-\d{4}-\d{2}-\d{2}\.pdf$/);
  });
});

describe("isMobileSharePlatform", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("detects Android user agents", () => {
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile",
      platform: "Linux armv8l",
      maxTouchPoints: 5,
    });
    expect(isMobileSharePlatform()).toBe(true);
  });

  it("detects iPhone user agents", () => {
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
      platform: "iPhone",
      maxTouchPoints: 5,
    });
    expect(isMobileSharePlatform()).toBe(true);
  });
});

describe("trySharePdfFile", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns unsupported when navigator.share is missing", async () => {
    vi.stubGlobal("navigator", { userAgent: "desktop" });
    const file = new File(["pdf"], "receipt.pdf", { type: "application/pdf" });
    await expect(trySharePdfFile(file, "receipt.pdf")).resolves.toBe("unsupported");
  });

  it("shares pdf files when canShare accepts them", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", {
      userAgent: "desktop",
      share,
      canShare: () => true,
    });
    const file = new File(["pdf"], "receipt.pdf", { type: "application/pdf" });
    await expect(trySharePdfFile(file, "receipt.pdf")).resolves.toBe("file");
    expect(share).toHaveBeenCalledWith({ title: "receipt.pdf", files: [file] });
  });
});
