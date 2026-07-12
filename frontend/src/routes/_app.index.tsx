import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { ProductCatalog } from "@/components/POS/ProductCatalog";
import { CartPanel } from "@/components/Cart/CartPanel";
import { languageService } from "@/services/language";
import { usePermissions } from "@/hooks/use-permissions";
import { connectCatalogEvents } from "@/lib/catalog-events";
import { loadPaymentTypes } from "@/lib/payment-service";
import { useAuth } from "@/store/auth";
import { usePosConfig } from "@/store/pos-config";
import { useSellContext } from "@/store/sell-context";
import { useCheckoutTabs } from "@/store/checkout-tabs";
import { useCatalog } from "@/store/catalog";
import { useLanguage } from "@/contexts/LanguageContext";
import { toast } from "sonner";
import { downloadCompleteCatalog } from "@/lib/catalog-service";
import { performIncrementalSync } from "@/lib/catalog-incremental-sync";
import { subscribeAppResume } from "@/lib/app-resume";
import { buildCatalogScopeKey } from "@/lib/pulse-pos-db";
import styles from "@/components/POS/POS.module.css";

export const Route = createFileRoute("/_app/")({
  head: () => ({
    meta: [
      { title: languageService.t("meta.sellTitle", "Sell · Regos Optom") },
      {
        name: "description",
        content: languageService.t("meta.sellDescription", "Process sales and take payments."),
      },
    ],
  }),
  component: PosPage,
});

function PosPage() {
  const queryClient = useQueryClient();
  const token = useAuth((s) => s.accessToken);
  const user = useAuth((s) => s.user);
  const hydrate = usePosConfig((s) => s.hydrate);
  const hydrateSellContext = useSellContext((s) => s.hydrate);
  const hydrateCheckoutTabs = useCheckoutTabs((s) => s.hydrate);
  const resetCheckoutTabs = useCheckoutTabs((s) => s.reset);
  const hydrateCatalogUi = useCatalog((s) => s.hydrateUiPreferences);
  const patchProducts = useCatalog((s) => s.patchProducts);
  const removeProducts = useCatalog((s) => s.removeProducts);
  const requestGroupsRefresh = useCatalog((s) => s.requestGroupsRefresh);
  const warehouseId = useSellContext((s) => s.warehouseId);
  const priceTypeId = useSellContext((s) => s.priceTypeId);
  const requestRefresh = useCatalog((s) => s.requestRefresh);
  const sellContextHydrated = useSellContext((s) => s.hydrated);
  const { canChangePosContext, canChangeWarehouse, canChangePriceType } = usePermissions();
  const canChangePosContextPerm = canChangePosContext();
  const canChangeWarehousePerm = canChangeWarehouse();
  const canChangePriceTypePerm = canChangePriceType();
  const catalogEventsRef = useRef<ReturnType<typeof connectCatalogEvents> | null>(null);
  const startupSyncDoneForScope = useRef<string | null>(null);
  const catalogDownloadingRef = useRef(false);

  useEffect(() => {
    void hydrateCatalogUi();
  }, [hydrateCatalogUi]);

  useEffect(() => {
    void hydrate(token, {
      userId: user?.id,
      companyId: user?.company_id,
    });
    void hydrateSellContext(token, canChangePosContextPerm, {
      userId: user?.id,
      companyId: user?.company_id,
    });
  }, [canChangePosContextPerm, hydrate, hydrateSellContext, token, user?.company_id, user?.id]);

  useEffect(() => {
    if (!token || !user) {
      resetCheckoutTabs();
      return;
    }
    if (!sellContextHydrated) return;
    void hydrateCheckoutTabs(user.id, user.company_id);
  }, [
    hydrateCheckoutTabs,
    resetCheckoutTabs,
    sellContextHydrated,
    token,
    user,
  ]);

  useEffect(() => {
    if (!token || !user?.company_id) return;
    void loadPaymentTypes(token, user.company_id);
  }, [token, user?.company_id]);

  const { t } = useLanguage();

  useEffect(() => {
    if (
      !token ||
      !user?.company_id ||
      warehouseId === null ||
      priceTypeId === null ||
      !sellContextHydrated
    ) {
      return;
    }

    const scopeKey = buildCatalogScopeKey(user.company_id, warehouseId, priceTypeId);
    const statusKey = `catalog_download_status:${user.company_id}:${warehouseId}:${priceTypeId}`;
    let cancelled = false;

    const applySyncResult = (
      syncResult: Awaited<ReturnType<typeof performIncrementalSync>>,
    ) => {
      if (
        syncResult.synced &&
        (syncResult.updatedCount > 0 ||
          syncResult.removedCount > 0 ||
          syncResult.groupsInvalidated)
      ) {
        requestRefresh();
        if (syncResult.groupsInvalidated) {
          requestGroupsRefresh();
        }
      }
      return syncResult.fullSyncRequired;
    };

    const ensureCatalogReady = async (options?: { force?: boolean }) => {
      // One successful startup sync per scope; forced resumes always re-check events_log.
      if (!options?.force && startupSyncDoneForScope.current === scopeKey) {
        return;
      }

      let fullSyncRequired = false;

      try {
        const syncResult = await performIncrementalSync(
          token,
          scopeKey,
          {
            companyId: user.company_id,
            warehouseId: warehouseId ?? undefined,
            priceTypeId: priceTypeId ?? undefined,
          },
          { force: options?.force },
        );

        if (cancelled) return;
        fullSyncRequired = applySyncResult(syncResult);
        if (fullSyncRequired) {
          localStorage.removeItem(statusKey);
        }
      } catch {
        // Incremental sync failed (e.g. network error) — continue to full download check
      }

      if (cancelled) return;

      const status = localStorage.getItem(statusKey);
      if (status === "completed" && !fullSyncRequired) {
        // Mark done only after a completed catch-up so cancelled remounts can retry.
        startupSyncDoneForScope.current = scopeKey;
        return;
      }

      if (catalogDownloadingRef.current) return;
      catalogDownloadingRef.current = true;

      const toastId = toast.loading(
        t("pos.catalog.downloading", "Downloading complete product catalog..."),
      );
      try {
        await downloadCompleteCatalog(token, {
          companyId: user.company_id,
          warehouseId,
          priceTypeId,
        });
        if (cancelled) return;
        localStorage.setItem(statusKey, "completed");
        toast.success(t("pos.catalog.downloadSuccess", "Catalog downloaded successfully!"), {
          id: toastId,
        });
        requestRefresh();
        requestGroupsRefresh();
        startupSyncDoneForScope.current = scopeKey;
      } catch {
        if (cancelled) return;
        toast.error(t("pos.catalog.downloadFailure", "Failed to download catalog."), {
          id: toastId,
        });
      } finally {
        catalogDownloadingRef.current = false;
      }
    };

    void ensureCatalogReady();

    const unsubscribeResume = subscribeAppResume(() => {
      void ensureCatalogReady({ force: true });
    });

    return () => {
      cancelled = true;
      unsubscribeResume();
    };
  }, [
    token,
    user?.company_id,
    warehouseId,
    priceTypeId,
    sellContextHydrated,
    requestRefresh,
    requestGroupsRefresh,
    t,
  ]);

  useEffect(() => {
    catalogEventsRef.current?.close();
    catalogEventsRef.current = null;

    if (!token || !user?.company_id || !sellContextHydrated) return;

    catalogEventsRef.current = connectCatalogEvents(
      token,
      {
        companyId: user.company_id,
        warehouseId,
        priceTypeId,
        canChangeWarehouse: canChangeWarehousePerm,
        canChangePriceType: canChangePriceTypePerm,
      },
      {
        onProductsUpdated: (products) => {
          patchProducts(products);
        },
        onProductsRemoved: (productIds) => {
          removeProducts(productIds);
        },
        onGroupsInvalidated: () => {
          requestGroupsRefresh();
        },
        onPaymentTypesUpdated: () => {
          void queryClient.invalidateQueries({ queryKey: ["regos", "payment-types"] });
        },
        onPaymentTypesRemoved: () => {
          void queryClient.invalidateQueries({ queryKey: ["regos", "payment-types"] });
        },
      },
    );

    return () => {
      catalogEventsRef.current?.close();
      catalogEventsRef.current = null;
    };
  }, [
    canChangePriceTypePerm,
    canChangeWarehousePerm,
    patchProducts,
    priceTypeId,
    queryClient,
    removeProducts,
    requestGroupsRefresh,
    sellContextHydrated,
    token,
    user?.company_id,
    warehouseId,
  ]);

  return (
    <div className={styles.page}>
      <ProductCatalog />
      <CartPanel />
    </div>
  );
}
