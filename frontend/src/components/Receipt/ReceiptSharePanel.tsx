import { useEffect, useState } from "react";
import { Copy, Link2, QrCode, Share2 } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { Button } from "@/components/posui/Button";
import { useLanguage } from "@/contexts/LanguageContext";
import type { ShareSession } from "@/hooks/use-receipt-share-session";
import styles from "./ReceiptShare.module.css";

type Props = {
  disabled?: boolean;
  session: ShareSession;
  linkExpired: boolean;
  ensureShareUrl: () => Promise<{ url: string; public_expires_at: string }>;
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

async function shareWebUrl(title: string, url: string): Promise<void> {
  await navigator.share({ title, url });
}

export function ReceiptSharePanel({
  disabled = false,
  session,
  linkExpired,
  ensureShareUrl,
  onRegenerate,
}: Props) {
  const { t } = useLanguage();
  const [showQr, setShowQr] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<"share" | "qr" | "copy" | null>(null);
  const [shareSupported, setShareSupported] = useState(false);

  useEffect(() => {
    setShareSupported(typeof navigator.share === "function");
  }, []);

  const loading =
    disabled ||
    session.status === "creating" ||
    busyAction !== null;
  const expiryHint = formatExpiryHint(session.expiresAt, t);

  const handleShare = async () => {
    if (linkExpired) {
      onRegenerate();
    }
    setBusyAction("share");
    try {
      const result = await ensureShareUrl();
      setShareUrl(result.url);
      const shareTitle = t("receipt.share.title", "Share receipt");

      if (shareSupported) {
        await shareWebUrl(shareTitle, result.url);
        return;
      }

      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(result.url);
        toast.success(t("receipt.share.copied", "Link copied"));
      }
    } catch (error) {
      if (isShareAbort(error)) return;
      toast.error(t("receipt.share.errors.upload", "Failed to create share link."));
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
      toast.error(t("receipt.share.errors.upload", "Failed to create share link."));
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

      {session.status === "creating" && (
        <div className={styles.shareHint}>
          {t("receipt.share.preparing", "Creating link…")}
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
          <Share2 size={16} /> {t("receipt.share.action", "Share")}
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

