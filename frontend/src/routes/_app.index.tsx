import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { ProductCatalog } from "@/components/POS/ProductCatalog";
import { CartPanel } from "@/components/Cart/CartPanel";
import { languageService } from "@/services/language";
import { usePermissions } from "@/hooks/use-permissions";
import { connectCatalogEvents, shouldForceCatalogGapFill, subscribeCatalogEventsReconnect } from "@/lib/catalog-events";
import { loadPaymentTypes } from "@/lib/payment-service";
import { useAuth } from "@/store/auth";
import { usePosConfig } from "@/store/pos-config";
import { useSellContext } from "@/store/sell-context";
import { useCheckoutTabs } from "@/store/checkout-tabs";
import { useCatalog } from "@/store/catalog";
import { useLanguage } from "@/contexts/LanguageContext";
import { ensureCatalogReady } from "@/lib/ensure-catalog-ready";
import { subscribeAppResume } from "@/lib/app-resume";
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

    // Match ProductCatalog / catalog-events: locked users share the default
    // scope key (warehouse/priceType omitted → 0), not the sell-context IDs.
    const catalogWarehouseId =
      canChangeWarehousePerm && warehouseId ? warehouseId : undefined;
    const catalogPriceTypeId =
      canChangePriceTypePerm && priceTypeId ? priceTypeId : undefined;
    let cancelled = false;

    const runEnsure = async (options?: { force?: boolean }) => {
      await ensureCatalogReady(
        token,
        {
          companyId: user.company_id,
          warehouseId: catalogWarehouseId,
          priceTypeId: catalogPriceTypeId,
        },
        {
          force: options?.force,
          skipIfDone: true,
          doneForScopeRef: startupSyncDoneForScope,
          isCancelled: () => cancelled,
          uiHandlers: {
            patchProducts,
            removeProducts,
            requestGroupsRefresh,
          },
          onDownloaded: () => {
            requestRefresh();
            requestGroupsRefresh();
          },
          t,
        },
      );
    };

    void runEnsure();

    const unsubscribeResume = subscribeAppResume(() => {
      void runEnsure({ force: shouldForceCatalogGapFill() });
    });

    const unsubscribeReconnect = subscribeCatalogEventsReconnect(() => {
      void runEnsure({ force: true });
    });

    return () => {
      cancelled = true;
      unsubscribeResume();
      unsubscribeReconnect();
    };
  }, [
    token,
    user?.company_id,
    warehouseId,
    priceTypeId,
    sellContextHydrated,
    canChangeWarehousePerm,
    canChangePriceTypePerm,
    patchProducts,
    removeProducts,
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
