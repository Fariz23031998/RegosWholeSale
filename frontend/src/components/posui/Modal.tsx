import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import clsx from "clsx";
import styles from "./Modal.module.css";

type Props = {
  open: boolean;
  onClose: () => void;
  title?: string;
  size?: "md" | "lg";
  overlayClassName?: string;
  modalClassName?: string;
  bodyClassName?: string;
  children: ReactNode;
};

export function Modal({
  open,
  onClose,
  title,
  size = "md",
  overlayClassName,
  modalClassName,
  bodyClassName,
  children,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className={clsx(styles.overlay, overlayClassName)} onMouseDown={onClose}>
      <div
        className={clsx(styles.modal, size === "lg" && styles.lg, modalClassName)}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {title && (
          <div className={styles.header}>
            <div className={styles.title}>{title}</div>
            <button className={styles.close} onClick={onClose} aria-label="Close">
              <X size={18} />
            </button>
          </div>
        )}
        <div className={clsx(styles.body, bodyClassName)}>{children}</div>
      </div>
    </div>
  );
}
