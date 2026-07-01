import { useEffect, useState } from "react";
import { Copy, Link2, QrCode, Share2 } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { Button } from "@/components/posui/Button";
import { useLanguage } from "@/contexts/LanguageContext";
import type { ShareSession } from "@/hooks/use-receipt-share-session";
import {
  buildReceiptFilename,
  downloadPdfBlob,
  isMobileSharePlatform,
  shareWebUrl,
  trySharePdfFile,
} from "@/lib/receipt-pdf";
import styles from "./ReceiptShare.module.css";

type Props = {
  disabled?: boolean;
  documentCode: string;
  session: ShareSession;
  linkExpired: boolean;
  getPdfBlob: () => Promise<Blob>;
  ensureShareUrl: () => Promise<{ url: string; expires_at: string }>;
  onRegenerate: () => void;
};

function formatExpiryHint(expiresAt: string | null, t: (key: string, fallback: string) => string): string {
  if (!expiresAt) return "";
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return "";
  return t(
    "receipt.share.linkExpires",
    "Link expires {{time}}",
  ).replace("{{time}}", date.toLocaleString());
}

function isShareAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function ReceiptSharePanel({
  disabled = false,
  documentCode,
  session,
  linkExpired,
  getPdfBlob,
  ensureShareUrl,
  onRegenerate,
}: Props) {
  const { t } = useLanguage();
  const [showQr, setShowQr] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<"share" | "qr" | "copy" | null>(null);
  const [shareSupported, setShareSupported] = useState(false);
  const [mobileSharePlatform, setMobileSharePlatform] = useState(false);

  useEffect(() => {
    setShareSupported(typeof navigator.share === "function");
    setMobileSharePlatform(isMobileSharePlatform());
  }, []);

  const loading =
    disabled ||
    session.status === "generating" ||
    session.status === "uploading" ||
    busyAction !== null;
  const expiryHint = formatExpiryHint(session.expiresAt, t);

  const shareButtonLabel = mobileSharePlatform && shareSupported
    ? t("receipt.share.action", "Share")
    : shareSupported
      ? t("receipt.share.shareToApps", "Share to apps")
      : t("receipt.share.downloadPdf", "Download PDF");

  const handleShare = async () => {
    if (linkExpired) {
      onRegenerate();
    }
    setBusyAction("share");
    try {
      const blob = await getPdfBlob();
      const filename = buildReceiptFilename(documentCode);
      const file = new File([blob], filename, { type: "application/pdf" });
      const shareTitle = t("receipt.share.title", "Share receipt");

      const fileShared = await trySharePdfFile(file, filename);
      if (fileShared === "file") return;

      if (shareSupported && mobileSharePlatform) {
        const result = await ensureShareUrl();
        setShareUrl(result.url);
        await shareWebUrl(shareTitle, result.url);
        return;
      }

      if (shareSupported) {
        toast.error(
          t(
            "receipt.share.errors.shareUnavailable",
            "Sharing is not available on this device.",
          ),
        );
        return;
      }

      downloadPdfBlob(blob, filename);
    } catch (error) {
      if (isShareAbort(error)) return;
      toast.error(t("receipt.share.errors.generate", "Could not create PDF. Try Print instead."));
    } finally {
      setBusyAction(null);
    }
  };

  const handleShowQr = async () => {
    if (linkExpired) {
      onRegenerate();
    }
    setBusyAction("qr");
    try {
      const result = await ensureShareUrl();
      setShareUrl(result.url);
      setShowQr(true);
    } catch {
      toast.error(t("receipt.share.errors.upload", "Failed to upload receipt for sharing."));
    } finally {
      setBusyAction(null);
    }
  };

  const handleCopyLink = async () => {
    if (linkExpired) {
      onRegenerate();
    }
    setBusyAction("copy");
    try {
      const result = await ensureShareUrl();
      setShareUrl(result.url);
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(result.url);
        toast.success(t("receipt.share.copied", "Link copied"));
      }
    } catch {
      toast.error(t("receipt.share.errors.clipboard", "Could not copy link."));
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className={styles.sharePanel}>
      <div className={styles.shareTitle}>{t("receipt.share.title", "Share receipt")}</div>

      {session.status === "generating" && (
        <div className={styles.shareHint}>
          {t("receipt.share.preparing", "Preparing PDF…")}
        </div>
      )}
      {session.status === "uploading" && (
        <div className={styles.shareHint}>
          {t("receipt.share.uploading", "Uploading…")}
        </div>
      )}
      {session.error ? <div className={styles.shareError}>{session.error}</div> : null}
      {linkExpired ? (
        <div className={styles.shareError}>
          {t("receipt.share.expired", "Link expired — tap to regenerate")}
        </div>
      ) : null}

      <div className={styles.shareActionsRow}>
        <Button
          variant="secondary"
          full
          disabled={loading}
          onClick={() => void handleShare()}
        >
          <Share2 size={16} /> {shareButtonLabel}
        </Button>

        <Button variant="secondary" full disabled={loading} onClick={() => void handleShowQr()}>
          <QrCode size={16} /> {t("receipt.share.showQr", "QR code")}
        </Button>

        <Button variant="secondary" full disabled={loading} onClick={() => void handleCopyLink()}>
          <Copy size={16} /> {t("receipt.share.copyLink", "Copy link")}
        </Button>
      </div>

      {showQr && shareUrl ? (
        <div className={styles.qrWrap}>
          <div className={styles.qrImage}>
            <QRCodeSVG value={shareUrl} size={180} level="M" />
          </div>
          {expiryHint ? <div className={styles.shareHint}>{expiryHint}</div> : null}
        </div>
      ) : null}

      {shareUrl && !showQr ? (
        <label className={styles.shareHint}>
          <Link2 size={14} /> {t("receipt.share.manualCopy", "Copy link manually")}
          <input className={styles.linkField} readOnly value={shareUrl} onFocus={(e) => e.target.select()} />
        </label>
      ) : null}
    </div>
  );
}
