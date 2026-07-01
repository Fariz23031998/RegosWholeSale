import { forwardRef } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  active: boolean;
};

export const PrintAreaPortal = forwardRef<HTMLDivElement, Props>(function PrintAreaPortal(
  { children, active },
  ref,
) {
  if (!active || typeof document === "undefined") return null;

  return createPortal(
    <div ref={ref} className="print-root print-area">
      {children}
    </div>,
    document.body,
  );
});
