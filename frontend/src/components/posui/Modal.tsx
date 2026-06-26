import { X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { useLanguage } from "@/contexts/LanguageContext";
import styles from "./Modal.module.css";

type Props = {
  open: boolean;
  onClose: () => void;
  title?: string;
  size?: "md" | "lg" | "xl";
  fullscreen?: boolean;
  elevated?: boolean;
  overlayClassName?: string;
  modalClassName?: string;
  bodyClassName?: string;
  headerActions?: ReactNode;
  children: ReactNode;
};

export function Modal({
  open,
  onClose,
  title,
  size = "md",
  fullscreen = false,
  elevated = false,
  overlayClassName,
  modalClassName,
  bodyClassName,
  headerActions,
  children,
}: Props) {
  const { t } = useLanguage();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !mounted || typeof document === "undefined") return null;

  return createPortal(
    <div
      className={clsx(
        styles.overlay,
        fullscreen && styles.fullscreenOverlay,
        elevated && styles.elevatedOverlay,
        overlayClassName,
      )}
      onMouseDown={onClose}
    >
      <div
        className={clsx(
          styles.modal,
          size === "lg" && styles.lg,
          size === "xl" && styles.xl,
          fullscreen && styles.fullscreen,
          modalClassName,
        )}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {title && (
          <div className={styles.header}>
            <div className={styles.title}>{title}</div>
            {headerActions ? (
              <div className={styles.headerActions}>{headerActions}</div>
            ) : null}
            <button className={styles.close} onClick={onClose} aria-label={t("common.close", "Close")}>
              <X size={18} />
            </button>
          </div>
        )}
        <div className={clsx(styles.body, bodyClassName)}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}
