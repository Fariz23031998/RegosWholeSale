import { useMemo } from "react";
import { useAuth } from "@/store/auth";

const EMPTY_PERMISSIONS: string[] = [];

export function usePermissions() {
  const permissions = useAuth((s) => s.user?.permissions ?? EMPTY_PERMISSIONS);

  return useMemo(
    () => ({
      permissions,
      can: (code: string) => permissions.includes(code),
      canAny: (...codes: string[]) => codes.some((code) => permissions.includes(code)),
      canChangeWarehouse: () => permissions.includes("pos.change_warehouse"),
      canChangePriceType: () => permissions.includes("pos.change_price_type"),
      canChangePartner: () => permissions.includes("pos.change_partner"),
      canChangePosContext: () =>
        permissions.includes("pos.change_warehouse") ||
        permissions.includes("pos.change_price_type") ||
        permissions.includes("pos.change_partner"),
      canApplyDiscount: () => permissions.includes("pos.apply_discount"),
      canModifyPrice: () => permissions.includes("pos.modify_price"),
      canPostponeSale: () => permissions.includes("sales.postpone"),
      canContinueSale: () => permissions.includes("sales.continue"),
      canPrintDocuments: () => permissions.includes("documents.print"),
    }),
    [permissions],
  );
}