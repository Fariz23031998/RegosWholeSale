import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { ProductCatalog } from "@/components/POS/ProductCatalog";
import { CartPanel } from "@/components/Cart/CartPanel";
import { languageService } from "@/services/language";
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
  const token = useAuth((s) => s.accessToken);
  const user = useAuth((s) => s.user);
  const hydrate = usePosConfig((s) => s.hydrate);
  const hydrateSellContext = useSellContext((s) => s.hydrate);
  const hydrateCheckoutTabs = useCheckoutTabs((s) => s.hydrate);
  const resetCheckoutTabs = useCheckoutTabs((s) => s.reset);
  const hydrateCatalogUi = useCatalog((s) => s.hydrateUiPreferences);
  const canOverrideRegos = Boolean(user?.permissions.includes("pos.override_regos"));

  useEffect(() => {
    void hydrateCatalogUi();
  }, [hydrateCatalogUi]);

  useEffect(() => {
    void hydrate(token);
    void hydrateSellContext(token, canOverrideRegos);
  }, [canOverrideRegos, hydrate, hydrateSellContext, token]);

  useEffect(() => {
    if (!token || !user) {
      resetCheckoutTabs();
      return;
    }
    void hydrateCheckoutTabs(user.id, user.company_id);
  }, [hydrateCheckoutTabs, resetCheckoutTabs, token, user]);

  return (
    <div className={styles.page}>
      <ProductCatalog />
      <CartPanel />
    </div>
  );
}
