import { startTransition, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  Database,
  ShoppingCart,
  Users,
  Settings,
  Receipt,
  Trash2,
  RefreshCw,
} from "lucide-react";
import clsx from "clsx";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/store/auth";
import { useCatalog } from "@/store/catalog";
import { useSellContext } from "@/store/sell-context";
import { usePermissions } from "@/hooks/use-permissions";
import { toast } from "sonner";
import {
  clearProductCatalogCache,
  clearPartnersCache,
  clearSettingsCache,
  clearPaymentTypesCache,
  clearAllCaches,
} from "@/lib/cache-service";
import {
  isCacheEnabled,
  setCacheEnabled,
  subscribeCacheEnabled,
} from "@/lib/cache-policy";
import { downloadCompleteCatalog } from "@/lib/catalog-service";
import { setCatalogDownloadStatus } from "@/lib/catalog-incremental-sync";
import { forceFullMetaRefresh } from "@/lib/meta-incremental-sync";
import { SETTINGS_QUERY_KEYS } from "@/lib/settings-api";
import styles from "./CacheManagement.module.css";

type Props = {
  className?: string;
  variant?: "menu";
};

type MenuPosition = {
  top: number;
  left: number;
  minWidth: number;
};

export function CacheManagement({ className, variant = "menu" }: Props) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [cacheEnabled, setCacheEnabledState] = useState(() => isCacheEnabled());
  const [togglingCache, setTogglingCache] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const user = useAuth((s) => s.user);
  const accessToken = useAuth((s) => s.accessToken);
  const { canChangePosContext } = usePermissions();

  useEffect(() => {
    return subscribeCacheEnabled(() => {
      setCacheEnabledState(isCacheEnabled());
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setMenuPosition(null);
      return;
    }

    const updatePosition = () => {
      const trigger = triggerRef.current;
      const menu = menuRef.current;
      if (!trigger) return;

      const rect = trigger.getBoundingClientRect();
      const menuHeight = menu?.offsetHeight ?? 0;
      const menuWidth = menu?.offsetWidth ?? 0;
      const gap = 6;
      const padding = 12;
      const maxWidth = Math.min(320, window.innerWidth - padding * 2);
      const minWidth = Math.min(Math.max(rect.width, menuWidth), maxWidth);

      let left = rect.left;
      if (left + minWidth > window.innerWidth - padding) {
        left = Math.max(padding, window.innerWidth - padding - minWidth);
      }

      let top = rect.top - gap - menuHeight;
      if (top < padding) {
        top = Math.min(rect.bottom + gap, window.innerHeight - padding - menuHeight);
      }

      setMenuPosition({
        top,
        left,
        minWidth,
      });
    };

    updatePosition();
    // Re-measure after first paint once menu height is known
    const frame = requestAnimationFrame(updatePosition);

    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
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

  const handleCacheToggle = async (enabled: boolean) => {
    if (togglingCache) return;

    setTogglingCache(true);
    try {
      setCacheEnabled(enabled);
      if (!enabled && user?.company_id) {
        await clearAllCaches(user.company_id);
      }
    } catch {
      toast.error(t("cache.toggleError", "Failed to update cache setting."));
    } finally {
      setTogglingCache(false);
    }
  };

  const handleUpdate = async () => {
    setOpen(false);
    if (!accessToken || !user?.company_id || !user.id || updating) return;

    if (!isCacheEnabled()) {
      toast.error(
        t("cache.updateDisabled", "Enable caching to update the cache."),
      );
      return;
    }

    setUpdating(true);
    const toastId = toast.loading(t("cache.updating", "Updating cache..."));
    try {
      const { warehouseId, priceTypeId } = useSellContext.getState();

      await downloadCompleteCatalog(accessToken, {
        companyId: user.company_id,
        warehouseId,
        priceTypeId,
      });
      setCatalogDownloadStatus(
        user.company_id,
        warehouseId,
        priceTypeId,
        "completed",
      );

      await forceFullMetaRefresh(
        accessToken,
        { companyId: user.company_id, userId: user.id },
        canChangePosContext(),
      );

      useCatalog.getState().requestRefresh();
      useCatalog.getState().requestGroupsRefresh();

      void queryClient.invalidateQueries({
        queryKey: SETTINGS_QUERY_KEYS.pos(accessToken),
      });
      void queryClient.invalidateQueries({
        queryKey: SETTINGS_QUERY_KEYS.regosBootstrap(accessToken),
      });
      void queryClient.invalidateQueries({
        queryKey: SETTINGS_QUERY_KEYS.receiptTemplates(accessToken),
      });
      void queryClient.invalidateQueries({
        queryKey: SETTINGS_QUERY_KEYS.exchangeRateSync(accessToken),
      });
      void queryClient.invalidateQueries({
        queryKey: ["regos", "reference-options", accessToken],
      });

      toast.success(t("cache.updateSuccess", "Cache updated successfully."), {
        id: toastId,
      });
    } catch {
      toast.error(t("cache.updateError", "Failed to update cache."), {
        id: toastId,
      });
    } finally {
      setUpdating(false);
    }
  };

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

  const menu = open
    ? createPortal(
        <div
          ref={menuRef}
          className={clsx(styles.menu, styles.menuFixed)}
          role="menu"
          style={
            menuPosition
              ? {
                  top: menuPosition.top,
                  left: menuPosition.left,
                  minWidth: menuPosition.minWidth,
                }
              : { visibility: "hidden" as const, top: 0, left: 0 }
          }
        >
          <label className={styles.menuToggleRow}>
            <span>{t("cache.enableCaching", "Enable caching")}</span>
            <span className={styles.switch}>
              <input
                type="checkbox"
                checked={cacheEnabled}
                disabled={togglingCache}
                onChange={(event) => void handleCacheToggle(event.target.checked)}
              />
              <span className={styles.slider} />
            </span>
          </label>
          <div className={styles.menuDivider} />
          <button
            type="button"
            role="menuitem"
            className={styles.menuItem}
            disabled={!cacheEnabled || updating}
            onClick={() => void handleUpdate()}
          >
            <RefreshCw size={16} aria-hidden />
            <span className={styles.menuItemLabel}>
              {updating
                ? t("cache.updating", "Updating cache...")
                : t("cache.update", "Update Cache")}
            </span>
          </button>
          <div className={styles.menuDivider} />
          <button
            type="button"
            role="menuitem"
            className={styles.menuItem}
            onClick={() => void handleClear("catalog")}
          >
            <ShoppingCart size={16} aria-hidden />
            <span className={styles.menuItemLabel}>
              {t("cache.clearCatalog", "Clear Product Catalog")}
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            className={styles.menuItem}
            onClick={() => void handleClear("partners")}
          >
            <Users size={16} aria-hidden />
            <span className={styles.menuItemLabel}>
              {t("cache.clearPartners", "Clear Partners")}
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            className={styles.menuItem}
            onClick={() => void handleClear("settings")}
          >
            <Settings size={16} aria-hidden />
            <span className={styles.menuItemLabel}>
              {t("cache.clearSettings", "Clear Settings")}
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            className={styles.menuItem}
            onClick={() => void handleClear("payments")}
          >
            <Receipt size={16} aria-hidden />
            <span className={styles.menuItemLabel}>
              {t("cache.clearPayments", "Clear Payment Types")}
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            className={clsx(styles.menuItem, styles.danger)}
            onClick={() => void handleClear("all")}
          >
            <Trash2 size={16} aria-hidden />
            <span className={styles.menuItemLabel}>
              {t("cache.clearAll", "Clear All Cache")}
            </span>
          </button>
        </div>,
        document.body,
      )
    : null;

  return (
    <div ref={rootRef} className={clsx(styles.root, open && styles.rootOpen)}>
      <button
        ref={triggerRef}
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
      {menu}
    </div>
  );
}
