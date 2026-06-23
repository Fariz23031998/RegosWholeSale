import clsx from "clsx";
import { Plus, X } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  checkoutTabItemCount,
  useCheckoutTabs,
} from "@/store/checkout-tabs";
import styles from "./CheckoutTabs.module.css";

export function CheckoutTabs() {
  const { t } = useLanguage();
  const tabs = useCheckoutTabs((s) => s.tabs);
  const activeTabId = useCheckoutTabs((s) => s.activeTabId);
  const hydrated = useCheckoutTabs((s) => s.hydrated);
  const switchTab = useCheckoutTabs((s) => s.switchTab);
  const addTab = useCheckoutTabs((s) => s.addTab);
  const closeTab = useCheckoutTabs((s) => s.closeTab);

  if (!hydrated) return null;

  return (
    <div className={styles.bar}>
      <div className={styles.scroll} role="tablist" aria-label={t("cart.tabs.openSales", "Open sales")}>
        {tabs.map((tab) => {
          const itemCount = checkoutTabItemCount(tab);
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              className={clsx(styles.tab, isActive && styles.tabActive)}
            >
              <button
                type="button"
                role="tab"
                aria-selected={isActive}
                className={styles.tabBtn}
                onClick={() => switchTab(tab.id)}
              >
                <span className={styles.tabLabel}>{tab.label}</span>
                {itemCount > 0 && (
                  <span className={styles.tabBadge}>{itemCount}</span>
                )}
              </button>
              <button
                type="button"
                className={styles.closeBtn}
                onClick={() => closeTab(tab.id)}
                aria-label={t("cart.tabs.closeTab", "Close {{label}}", { label: tab.label })}
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        className={styles.addBtn}
        onClick={addTab}
        aria-label={t("cart.tabs.newTab", "New sale tab")}
        title={t("cart.tabs.newSale", "New sale")}
      >
        <Plus size={16} />
      </button>
    </div>
  );
}
