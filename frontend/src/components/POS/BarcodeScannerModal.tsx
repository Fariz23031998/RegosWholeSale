import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Flashlight, FlashlightOff, X } from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/contexts/LanguageContext";
import { Modal } from "@/components/posui/Modal";
import {
  CameraInsecureContextError,
  isCameraPermissionDenied,
  isTorchSupported,
  setTorchEnabled,
  startCameraBarcodeScanner,
  type ScannerControls,
} from "@/lib/barcode-scanner-camera";
import styles from "./POS.module.css";

const DUPLICATE_SCAN_MS = 2000;

type BarcodeScannerModalProps = {
  open: boolean;
  onClose: () => void;
  onScan: (barcode: string) => Promise<void>;
};

export function BarcodeScannerModal({ open, onClose, onScan }: BarcodeScannerModalProps) {
  const { t } = useLanguage();
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<ScannerControls | null>(null);
  const scanSessionRef = useRef(0);
  const processingRef = useRef(false);
  const lastScanRef = useRef<{ code: string; at: number } | null>(null);
  const [cameraError, setCameraError] = useState("");
  const [torchOn, setTorchOn] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);

  const stopScanner = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      void setTorchEnabled(video, false).catch(() => undefined);
      const stream = video.srcObject;
      if (stream instanceof MediaStream) {
        for (const track of stream.getTracks()) {
          track.stop();
        }
      }
      video.srcObject = null;
    }

    setTorchOn(false);
    setTorchAvailable(false);
    controlsRef.current?.stop();
    controlsRef.current = null;

    void import("@zxing/browser")
      .then(({ BrowserMultiFormatReader }) => {
        BrowserMultiFormatReader.releaseAllStreams();
      })
      .catch(() => undefined);
  }, []);

  const updateTorchAvailability = useCallback((videoEl: HTMLVideoElement, controls: ScannerControls) => {
    const hasZxingTorch = typeof controls.switchTorch === "function";
    setTorchAvailable(hasZxingTorch || isTorchSupported(videoEl));
  }, []);

  const applyTorch = useCallback(async (enabled: boolean) => {
    const video = videoRef.current;
    const controls = controlsRef.current;
    if (!video) return;

    if (controls?.switchTorch) {
      await controls.switchTorch(enabled);
    } else {
      await setTorchEnabled(video, enabled);
    }
    setTorchOn(enabled);
  }, []);

  const toggleTorch = useCallback(async () => {
    try {
      await applyTorch(!torchOn);
    } catch {
      toast.error(t("pos.barcode.torchUnavailable", "Flashlight is not available on this device"));
      setTorchAvailable(false);
      setTorchOn(false);
    }
  }, [applyTorch, t, torchOn]);
  const handleScanResult = useCallback(async (rawCode: string | undefined) => {
    const code = rawCode?.trim();
    if (!code || processingRef.current) return;

    const now = Date.now();
    const last = lastScanRef.current;
    if (last && last.code === code && now - last.at < DUPLICATE_SCAN_MS) {
      return;
    }

    processingRef.current = true;
    lastScanRef.current = { code, at: now };

    try {
      await onScanRef.current(code);
    } finally {
      processingRef.current = false;
    }
  }, []);

  const startScanner = useCallback(
    async (videoEl: HTMLVideoElement) => {
      stopScanner();
      const sessionId = ++scanSessionRef.current;

      try {
        if (scanSessionRef.current !== sessionId) return;

        const controls = await startCameraBarcodeScanner(videoEl, (code) => {
          void handleScanResult(code);
        });

        if (scanSessionRef.current !== sessionId) {
          controls.stop();
          return;
        }

        controlsRef.current = controls;
        updateTorchAvailability(videoEl, controls);
        setCameraError("");
      } catch (err) {
        if (scanSessionRef.current !== sessionId) return;

        const denied = isCameraPermissionDenied(err);
        const insecure = err instanceof CameraInsecureContextError;

        const message = insecure
          ? t(
              "pos.barcode.insecureContext",
              "Camera scanning requires HTTPS. Open the site with https:// instead of http://",
            )
          : denied
            ? t("pos.barcode.cameraDenied", "Camera access is required to scan barcodes")
            : t("pos.barcode.cameraUnavailable", "Could not start the camera");

        setCameraError(message);
        toast.error(message);
      }
    },
    [handleScanResult, stopScanner, t, updateTorchAvailability],
  );

  const setVideoRef = useCallback(
    (el: HTMLVideoElement | null) => {
      videoRef.current = el;
      if (!el) {
        stopScanner();
        return;
      }
      if (open) {
        void startScanner(el);
      }
    },
    [open, startScanner, stopScanner],
  );

  useEffect(() => {
    if (!open) {
      scanSessionRef.current += 1;
      stopScanner();
      processingRef.current = false;
      lastScanRef.current = null;
      setCameraError("");
      setTorchOn(false);
      setTorchAvailable(false);
    }
  }, [open, stopScanner]);

  useEffect(() => () => stopScanner(), [stopScanner]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("pos.scanBarcode", "Scan barcode")}
      fullscreen
      elevated
      modalClassName={styles.barcodeScannerModal}
      bodyClassName={styles.barcodeScannerBody}
    >
      <p className={styles.barcodeScannerHint}>
        {t("pos.scanBarcodeHint", "Point the camera at a product barcode")}
      </p>

      <div className={styles.barcodeScannerPreview}>
        {torchAvailable ? (
          <button
            type="button"
            className={clsx(
              styles.barcodeScannerTorch,
              torchOn && styles.barcodeScannerTorchActive,
            )}
            onClick={() => void toggleTorch()}
            aria-label={
              torchOn
                ? t("pos.barcode.torchOff", "Turn off flashlight")
                : t("pos.barcode.torchOn", "Turn on flashlight")
            }
            aria-pressed={torchOn}
          >
            {torchOn ? <FlashlightOff size={20} /> : <Flashlight size={20} />}
          </button>
        ) : null}
        <button
          type="button"
          className={styles.barcodeScannerClose}
          onClick={onClose}
          aria-label={t("common.close", "Close")}
        >
          <X size={20} />
        </button>
        <video ref={setVideoRef} className={styles.barcodeScannerVideo} muted playsInline autoPlay />
        <div className={styles.barcodeScannerOverlay} aria-hidden="true" />
      </div>

      {cameraError ? <p className={styles.barcodeScannerError}>{cameraError}</p> : null}
    </Modal>
  );
}
