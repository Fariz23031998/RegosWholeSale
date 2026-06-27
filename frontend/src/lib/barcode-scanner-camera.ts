type BarcodeScanResult = {
  getText: () => string;
};

export type BarcodeScanCallback = (
  result: BarcodeScanResult | undefined,
  error?: unknown,
) => void;

export type ScannerControls = {
  stop: () => void;
  switchTorch?: (onOff: boolean) => Promise<void>;
};

type BrowserReader = {
  decodeFromConstraints: (
    constraints: MediaStreamConstraints,
    previewElem: HTMLVideoElement,
    callbackFn: BarcodeScanCallback,
  ) => Promise<ScannerControls>;
  decodeFromVideoDevice: (
    deviceId: string | undefined,
    previewElem: HTMLVideoElement,
    callbackFn: BarcodeScanCallback,
  ) => Promise<ScannerControls>;
};

type NativeBarcodeDetector = {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue: string }>>;
};

type NativeBarcodeDetectorConstructor = {
  new (options?: { formats?: string[] }): NativeBarcodeDetector;
  getSupportedFormats?: () => Promise<string[]>;
};

const RETAIL_BARCODE_FORMATS = [
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
  "code_128",
  "code_39",
] as const;

/** Matches HTMLMediaElement.HAVE_CURRENT_DATA without relying on the DOM global. */
const VIDEO_HAS_CURRENT_FRAME = 2;

/** ZXing defaults to 500 ms between attempts — far too slow for live scanning. */
export const SCAN_ATTEMPT_INTERVAL_MS = 50;
export const SCAN_SUCCESS_INTERVAL_MS = 300;

export class CameraInsecureContextError extends Error {
  constructor() {
    super("Camera requires a secure context");
    this.name = "CameraInsecureContextError";
  }
}

export function isCameraSecureContext(): boolean {
  return typeof window !== "undefined" && window.isSecureContext;
}

export function isCameraScanAvailable(): boolean {
  return (
    isCameraSecureContext() &&
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function"
  );
}

/** Whether to show the catalog camera scan button in the current environment. */
export function shouldShowCameraScanButton(): boolean {
  // Always show in the browser. BarcodeScannerModal handles HTTPS, permission,
  // and hardware errors. Hiding the control on desktop/non-secure contexts caused
  // it to disappear in production while dev (narrow viewport) still showed it.
  return typeof window !== "undefined" && typeof navigator !== "undefined";
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

function getNativeBarcodeDetectorConstructor(): NativeBarcodeDetectorConstructor | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as Window & { BarcodeDetector?: NativeBarcodeDetectorConstructor })
    .BarcodeDetector;
}

export async function isNativeBarcodeDetectorAvailable(): Promise<boolean> {
  const BarcodeDetectorCtor = getNativeBarcodeDetectorConstructor();
  if (!BarcodeDetectorCtor) return false;

  try {
    const supported = await BarcodeDetectorCtor.getSupportedFormats?.();
    return !supported || supported.length > 0;
  } catch {
    return false;
  }
}

function buildHighResVideoConstraints(
  facingMode: MediaTrackConstraints["facingMode"],
  deviceId?: string,
): MediaTrackConstraints {
  const base: MediaTrackConstraints = {
    facingMode,
    width: { ideal: 1920, min: 1280 },
    height: { ideal: 1080, min: 720 },
    aspectRatio: { ideal: 16 / 9 },
  };

  if (deviceId) {
    return {
      ...base,
      deviceId: { exact: deviceId },
    };
  }

  return base;
}

/** Camera constraints ordered from best quality to most compatible. */
export function buildCameraConstraintAttempts(deviceId?: string): MediaStreamConstraints[] {
  return [
    { video: buildHighResVideoConstraints({ ideal: "environment" }, deviceId) },
    { video: buildHighResVideoConstraints({ exact: "environment" }, deviceId) },
    { video: buildHighResVideoConstraints("environment", deviceId) },
    {
      video: deviceId
        ? { deviceId: { exact: deviceId }, facingMode: { ideal: "environment" } }
        : { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
    },
    { video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: "environment" } } },
    { video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: "environment" } },
    { video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: "user" } } },
    { video: deviceId ? { deviceId: { exact: deviceId } } : true },
  ];
}

async function applyContinuousAutofocus(videoEl: HTMLVideoElement): Promise<void> {
  const stream = videoEl.srcObject;
  if (!(stream instanceof MediaStream)) return;

  const track = stream.getVideoTracks()[0];
  if (!track) return;

  try {
    await track.applyConstraints({
      advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet],
    });
  } catch {
    // Autofocus is optional; ignore unsupported devices.
  }
}

async function attachCameraStream(
  videoEl: HTMLVideoElement,
  constraints: MediaStreamConstraints,
): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  videoEl.srcObject = stream;
  videoEl.muted = true;
  videoEl.playsInline = true;
  await videoEl.play();
  await applyContinuousAutofocus(videoEl);
  return stream;
}

function stopMediaStream(videoEl: HTMLVideoElement): void {
  const stream = videoEl.srcObject;
  if (stream instanceof MediaStream) {
    for (const track of stream.getTracks()) {
      track.stop();
    }
  }
  videoEl.srcObject = null;
}

function wrapNativeTorchControls(
  controls: ScannerControls,
  videoEl: HTMLVideoElement,
): ScannerControls {
  if (typeof controls.switchTorch === "function") return controls;
  if (!isTorchSupported(videoEl)) return controls;

  return {
    ...controls,
    switchTorch: (enabled: boolean) => setTorchEnabled(videoEl, enabled),
  };
}

async function createNativeBarcodeDetector(): Promise<NativeBarcodeDetector> {
  const BarcodeDetectorCtor = getNativeBarcodeDetectorConstructor();
  if (!BarcodeDetectorCtor) {
    throw new Error("Native barcode detector is unavailable");
  }

  let formats: string[] = [...RETAIL_BARCODE_FORMATS];
  try {
    const supported = await BarcodeDetectorCtor.getSupportedFormats?.();
    if (supported?.length) {
      const retail = supported.filter((format) =>
        RETAIL_BARCODE_FORMATS.includes(format as (typeof RETAIL_BARCODE_FORMATS)[number]),
      );
      formats = retail.length > 0 ? retail : supported;
    }
  } catch {
    // Fall back to the default retail format list.
  }

  return new BarcodeDetectorCtor({ formats });
}

async function startNativeBarcodeScanner(
  videoEl: HTMLVideoElement,
  onCode: (code: string) => void,
): Promise<ScannerControls> {
  let lastError: unknown = null;

  for (const constraints of buildCameraConstraintAttempts()) {
    try {
      await attachCameraStream(videoEl, constraints);
      const detector = await createNativeBarcodeDetector();

      let stopped = false;
      let scanInFlight = false;
      let frameId = 0;

      const scanFrame = () => {
        if (stopped) return;
        frameId = window.requestAnimationFrame(scanFrame);
        if (scanInFlight || videoEl.readyState < VIDEO_HAS_CURRENT_FRAME) return;

        scanInFlight = true;
        void detector
          .detect(videoEl)
          .then((barcodes) => {
            const code = barcodes[0]?.rawValue?.trim();
            if (code) onCode(code);
          })
          .catch(() => undefined)
          .finally(() => {
            scanInFlight = false;
          });
      };

      frameId = window.requestAnimationFrame(scanFrame);

      const controls: ScannerControls = {
        stop: () => {
          if (stopped) return;
          stopped = true;
          window.cancelAnimationFrame(frameId);
          stopMediaStream(videoEl);
        },
      };

      return wrapNativeTorchControls(controls, videoEl);
    } catch (err) {
      stopMediaStream(videoEl);
      lastError = err;
      if (isPermissionDenied(err)) throw err;
    }
  }

  throw lastError ?? new Error("Could not start the native barcode scanner");
}

async function createZxingReader(): Promise<BrowserReader> {
  const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
    import("@zxing/browser"),
    import("@zxing/library"),
  ]);

  const hints = new Map<DecodeHintType, unknown>([
    [
      DecodeHintType.POSSIBLE_FORMATS,
      [
        BarcodeFormat.EAN_13,
        BarcodeFormat.EAN_8,
        BarcodeFormat.UPC_A,
        BarcodeFormat.UPC_E,
        BarcodeFormat.CODE_128,
        BarcodeFormat.CODE_39,
      ],
    ],
    [DecodeHintType.TRY_HARDER, true],
  ]);

  return new BrowserMultiFormatReader(hints, {
    delayBetweenScanAttempts: SCAN_ATTEMPT_INTERVAL_MS,
    delayBetweenScanSuccess: SCAN_SUCCESS_INTERVAL_MS,
  });
}

function adaptZxingCallback(onCode: (code: string) => void): BarcodeScanCallback {
  return (result) => {
    const code = result?.getText()?.trim();
    if (code) onCode(code);
  };
}

async function startZxingBarcodeScanner(
  videoEl: HTMLVideoElement,
  onCode: (code: string) => void,
): Promise<ScannerControls> {
  const reader = await createZxingReader();
  return startBarcodeScanner(reader, videoEl, adaptZxingCallback(onCode));
}

export async function startCameraBarcodeScanner(
  videoEl: HTMLVideoElement,
  onCode: (code: string) => void,
): Promise<ScannerControls> {
  if (!isCameraSecureContext()) {
    throw new CameraInsecureContextError();
  }

  if (await isNativeBarcodeDetectorAvailable()) {
    try {
      return await startNativeBarcodeScanner(videoEl, onCode);
    } catch (err) {
      if (isPermissionDenied(err)) throw err;
    }
  }

  return startZxingBarcodeScanner(videoEl, onCode);
}

export async function startBarcodeScanner(
  reader: BrowserReader,
  videoEl: HTMLVideoElement,
  callbackFn: BarcodeScanCallback,
): Promise<ScannerControls> {
  if (!isCameraSecureContext()) {
    throw new CameraInsecureContextError();
  }

  let lastError: unknown = null;

  for (const constraints of buildCameraConstraintAttempts()) {
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
    for (const constraints of buildCameraConstraintAttempts(deviceId)) {
      try {
        return await reader.decodeFromConstraints(constraints, videoEl, callbackFn);
      } catch (err) {
        lastError = err;
        if (isPermissionDenied(err)) throw err;
      }
    }

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
