import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useLanguage } from "@/contexts/LanguageContext";
import { Modal } from "@/components/posui/Modal";
import {
  CameraInsecureContextError,
  isCameraPermissionDenied,
  startBarcodeScanner,
} from "@/lib/barcode-scanner-camera";
import styles from "./POS.module.css";

const DUPLICATE_SCAN_MS = 2000;

type ScannerControls = {
  stop: () => void;
};

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

  const stopScanner = useCallback(() => {
    controlsRef.current?.stop();
    controlsRef.current = null;

    const video = videoRef.current;
    if (video) {
      const stream = video.srcObject;
      if (stream instanceof MediaStream) {
        for (const track of stream.getTracks()) {
          track.stop();
        }
      }
      video.srcObject = null;
    }

    void import("@zxing/browser")
      .then(({ BrowserMultiFormatReader }) => {
        BrowserMultiFormatReader.releaseAllStreams();
      })
      .catch(() => undefined);
  }, []);

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
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        if (scanSessionRef.current !== sessionId) return;

        const reader = new BrowserMultiFormatReader();
        const controls = await startBarcodeScanner(reader, videoEl, (result) => {
          void handleScanResult(result?.getText());
        });

        if (scanSessionRef.current !== sessionId) {
          controls.stop();
          return;
        }

        controlsRef.current = controls;
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
    [handleScanResult, stopScanner, t],
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
        <video ref={setVideoRef} className={styles.barcodeScannerVideo} muted playsInline autoPlay />
        <div className={styles.barcodeScannerOverlay} aria-hidden="true" />
      </div>

      {cameraError ? <p className={styles.barcodeScannerError}>{cameraError}</p> : null}
    </Modal>
  );
}
