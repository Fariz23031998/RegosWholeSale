import { useCheckoutTabs } from "@/store/checkout-tabs";
import { useSellContext } from "@/store/sell-context";

function allSalesClosed(): boolean {
  const tabs = useCheckoutTabs.getState().tabs;
  return tabs.every(
    (tab) => tab.items.length === 0 && (tab.postponedWholesaleDocId ?? null) == null,
  );
}

export function maybeResetSellContextAfterSaleClosed(): void {
  if (!allSalesClosed()) return;
  void useSellContext.getState().resetToDefaults();
}
