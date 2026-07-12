import { startTransition, useEffect, useRef, useState } from "react";
import { Database, ShoppingCart, Users, Settings, Receipt, Trash2 } from "lucide-react";
import clsx from "clsx";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/store/auth";
import { toast } from "sonner";
import {
  clearProductCatalogCache,
  clearPartnersCache,
  clearSettingsCache,
  clearPaymentTypesCache,
  clearAllCaches,
} from "@/lib/cache-service";
import styles from "./CacheManagement.module.css";

type Props = {
  className?: string;
  variant?: "menu";
};

export function CacheManagement({ className, variant = "menu" }: Props) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const user = useAuth((s) => s.user);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const handleClear = async (
    type: "catalog" | "partners" | "settings" | "payments" | "all",
  ) => {
    setOpen(false);
    if (!user?.company_id) return;
    try {
      if (type === "catalog") {
        await clearProductCatalogCache(user.company_id);
        toast.success(t("cache.clearCatalogSuccess", "Product catalog cache cleared."));
      } else if (type === "partners") {
        await clearPartnersCache();
        toast.success(t("cache.clearPartnersSuccess", "Partners cache cleared."));
      } else if (type === "settings") {
        await clearSettingsCache();
        toast.success(t("cache.clearSettingsSuccess", "Settings cache cleared."));
      } else if (type === "payments") {
        await clearPaymentTypesCache();
        toast.success(t("cache.clearPaymentsSuccess", "Payment types cache cleared."));
      } else if (type === "all") {
        await clearAllCaches(user.company_id);
        toast.success(t("cache.clearAllSuccess", "All cached data cleared."));
      }
    } catch {
      toast.error(t("cache.clearError", "Failed to clear cache."));
    }
  };

  return (
    <div ref={rootRef} className={styles.root}>
      <button
        type="button"
        className={clsx(styles.menuTrigger, className)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("cache.selectorLabel", "Cache Management")}
        onClick={(event) => {
          event.stopPropagation();
          startTransition(() => {
            setOpen((value) => !value);
          });
        }}
      >
        <Database size={18} />
        <span>{t("cache.selectorLabel", "Cache Management")}</span>
      </button>

      {open && (
        <div className={clsx(styles.menu, styles.menuAbove)} role="menu">
          <button
            type="button"
            role="menuitem"
            className={styles.menuItem}
            onClick={() => void handleClear("catalog")}
          >
            <ShoppingCart size={16} />
            {t("cache.clearCatalog", "Clear Product Catalog")}
          </button>
          <button
            type="button"
            role="menuitem"
            className={styles.menuItem}
            onClick={() => void handleClear("partners")}
          >
            <Users size={16} />
            {t("cache.clearPartners", "Clear Partners")}
          </button>
          <button
            type="button"
            role="menuitem"
            className={styles.menuItem}
            onClick={() => void handleClear("settings")}
          >
            <Settings size={16} />
            {t("cache.clearSettings", "Clear Settings")}
          </button>
          <button
            type="button"
            role="menuitem"
            className={styles.menuItem}
            onClick={() => void handleClear("payments")}
          >
            <Receipt size={16} />
            {t("cache.clearPayments", "Clear Payment Types")}
          </button>
          <button
            type="button"
            role="menuitem"
            className={clsx(styles.menuItem, styles.danger)}
            onClick={() => void handleClear("all")}
          >
            <Trash2 size={16} />
            {t("cache.clearAll", "Clear All Cache")}
          </button>
        </div>
      )}
    </div>
  );
}
