import { useCheckoutTabs } from "@/store/checkout-tabs";
import { useSellContext } from "@/store/sell-context";

/**
 * After clearing the cart without going through tab clear/checkout,
 * reset sell context when every sale tab is empty.
 * Checkout / close-tab paths already stamp defaults onto the cleared tab.
 */
export function maybeResetSellContextAfterSaleClosed(): void {
  const tabs = useCheckoutTabs.getState().tabs;
  const allClosed = tabs.every(
    (tab) => tab.items.length === 0 && (tab.postponedWholesaleDocId ?? null) == null,
  );
  if (!allClosed) return;
  void useSellContext.getState().resetToDefaults();
}
