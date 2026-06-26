import type { DecodeContinuouslyCallback } from "@zxing/browser";

type ScannerControls = {
  stop: () => void;
  switchTorch?: (onOff: boolean) => Promise<void>;
};

type BrowserReader = {
  decodeFromConstraints: (
    constraints: MediaStreamConstraints,
    previewElem: HTMLVideoElement,
    callbackFn: DecodeContinuouslyCallback,
  ) => Promise<ScannerControls>;
  decodeFromVideoDevice: (
    deviceId: string | undefined,
    previewElem: HTMLVideoElement,
    callbackFn: DecodeContinuouslyCallback,
  ) => Promise<ScannerControls>;
};

export class CameraInsecureContextError extends Error {
  constructor() {
    super("Camera requires a secure context");
    this.name = "CameraInsecureContextError";
  }
}

export function isCameraSecureContext(): boolean {
  return typeof window !== "undefined" && window.isSecureContext;
}

function isPermissionDenied(err: unknown): boolean {
  return (
    err instanceof DOMException &&
    (err.name === "NotAllowedError" || err.name === "PermissionDeniedError")
  );
}

function pickRearCameraId(devices: MediaDeviceInfo[]): string | undefined {
  const videoInputs = devices.filter((device) => device.kind === "videoinput");
  if (videoInputs.length === 0) return undefined;

  const rear = videoInputs.find((device) =>
    /back|rear|environment|задн|orqa/i.test(device.label),
  );
  return (rear ?? videoInputs[videoInputs.length - 1]).deviceId;
}

export async function startBarcodeScanner(
  reader: BrowserReader,
  videoEl: HTMLVideoElement,
  callbackFn: DecodeContinuouslyCallback,
): Promise<ScannerControls> {
  if (!isCameraSecureContext()) {
    throw new CameraInsecureContextError();
  }

  const constraintAttempts: MediaStreamConstraints[] = [
    { video: { facingMode: { exact: "environment" } } },
    { video: { facingMode: { ideal: "environment" } } },
    { video: { facingMode: "environment" } },
    { video: { facingMode: { ideal: "user" } } },
    { video: true },
  ];

  let lastError: unknown = null;

  for (const constraints of constraintAttempts) {
    try {
      return await reader.decodeFromConstraints(constraints, videoEl, callbackFn);
    } catch (err) {
      lastError = err;
      if (isPermissionDenied(err)) throw err;
    }
  }

  try {
    const { BrowserMultiFormatReader } = await import("@zxing/browser");
    const devices = await BrowserMultiFormatReader.listVideoInputDevices();
    const deviceId = pickRearCameraId(devices);
    if (deviceId) {
      return await reader.decodeFromVideoDevice(deviceId, videoEl, callbackFn);
    }
    return await reader.decodeFromVideoDevice(undefined, videoEl, callbackFn);
  } catch (err) {
    lastError = err;
    if (isPermissionDenied(err)) throw err;
  }

  throw lastError ?? new Error("Could not start the camera");
}

export function isCameraPermissionDenied(err: unknown): boolean {
  return isPermissionDenied(err);
}

type TorchCapableTrack = MediaTrackCapabilities & { torch?: boolean };

export function isTorchSupported(videoEl: HTMLVideoElement): boolean {
  const stream = videoEl.srcObject;
  if (!(stream instanceof MediaStream)) return false;

  const track = stream.getVideoTracks()[0];
  if (!track?.getCapabilities) return false;

  const capabilities = track.getCapabilities() as TorchCapableTrack;
  return capabilities.torch === true;
}

export async function setTorchEnabled(
  videoEl: HTMLVideoElement,
  enabled: boolean,
): Promise<void> {
  const stream = videoEl.srcObject;
  if (!(stream instanceof MediaStream)) {
    throw new Error("No active camera stream");
  }

  const track = stream.getVideoTracks()[0];
  if (!track) {
    throw new Error("No video track");
  }

  await track.applyConstraints({
    advanced: [{ torch: enabled } as MediaTrackConstraintSet],
  });
}

