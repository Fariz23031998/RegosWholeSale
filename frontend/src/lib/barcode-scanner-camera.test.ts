import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CameraInsecureContextError,
  isCameraScanAvailable,
  shouldShowCameraScanButton,
  startBarcodeScanner,
} from "./barcode-scanner-camera";

describe("startBarcodeScanner", () => {
  const videoEl = {} as HTMLVideoElement;
  const callback = vi.fn();
  const controls = { stop: vi.fn() };

  beforeEach(() => {
    vi.stubGlobal("window", { isSecureContext: true });
    callback.mockReset();
    controls.stop.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("isCameraScanAvailable is false outside a secure context", () => {
    vi.stubGlobal("window", { isSecureContext: false });
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn() } });

    expect(isCameraScanAvailable()).toBe(false);
  });

  it("isCameraScanAvailable is true when secure context and getUserMedia exist", () => {
    vi.stubGlobal("window", { isSecureContext: true });
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn() } });

    expect(isCameraScanAvailable()).toBe(true);
  });

  it("shouldShowCameraScanButton is true in the browser even without secure context", () => {
    vi.stubGlobal("window", { isSecureContext: false });
    vi.stubGlobal("navigator", {});

    expect(shouldShowCameraScanButton()).toBe(true);
  });

  it("shouldShowCameraScanButton is false during SSR", () => {
    vi.stubGlobal("window", undefined);
    vi.stubGlobal("navigator", {});

    expect(shouldShowCameraScanButton()).toBe(false);
  });

  it("throws when the page is not a secure context", async () => {
    vi.stubGlobal("window", { isSecureContext: false });

    const reader = {
      decodeFromConstraints: vi.fn(),
      decodeFromVideoDevice: vi.fn(),
    };

    await expect(startBarcodeScanner(reader, videoEl, callback)).rejects.toBeInstanceOf(
      CameraInsecureContextError,
    );
  });

  it("falls back to the next constraint when the first attempt fails", async () => {
    const reader = {
      decodeFromConstraints: vi
        .fn()
        .mockRejectedValueOnce(new DOMException("Unavailable", "NotFoundError"))
        .mockResolvedValueOnce(controls),
      decodeFromVideoDevice: vi.fn(),
    };

    const result = await startBarcodeScanner(reader, videoEl, callback);

    expect(result).toBe(controls);
    expect(reader.decodeFromConstraints).toHaveBeenCalledTimes(2);
  });

  it("rethrows permission errors immediately", async () => {
    const denied = new DOMException("Denied", "NotAllowedError");
    const reader = {
      decodeFromConstraints: vi.fn().mockRejectedValue(denied),
      decodeFromVideoDevice: vi.fn(),
    };

    await expect(startBarcodeScanner(reader, videoEl, callback)).rejects.toBe(denied);
    expect(reader.decodeFromVideoDevice).not.toHaveBeenCalled();
  });
});
