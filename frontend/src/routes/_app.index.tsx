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
  const sellContextHydrated = useSellContext((s) => s.hydrated);
  const { canChangePosContext, canChangeWarehouse, canChangePriceType } = usePermissions();
  const canChangePosContextPerm = canChangePosContext();
  const canChangeWarehousePerm = canChangeWarehouse();
  const canChangePriceTypePerm = canChangePriceType();
  const catalogEventsRef = useRef<ReturnType<typeof connectCatalogEvents> | null>(null);

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
    void hydrateCheckoutTabs(user.id, user.company_id);
  }, [hydrateCheckoutTabs, resetCheckoutTabs, token, user]);

  useEffect(() => {
    if (!token || !user?.company_id) return;
    void loadPaymentTypes(token, user.company_id);
  }, [token, user?.company_id]);

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
