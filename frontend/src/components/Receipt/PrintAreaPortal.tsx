import { createPortal } from "react-dom";
import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  active: boolean;
};

export function PrintAreaPortal({ children, active }: Props) {
  if (!active || typeof document === "undefined") return null;

  return createPortal(
    <div className="print-root print-area">{children}</div>,
    document.body,
  );
}
