import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { ProductCatalog } from "@/components/POS/ProductCatalog";
import { CartPanel } from "@/components/Cart/CartPanel";
import { useAuth } from "@/store/auth";
import { usePosConfig } from "@/store/pos-config";
import { useSellContext } from "@/store/sell-context";
import styles from "@/components/POS/POS.module.css";

export const Route = createFileRoute("/_app/")({
  head: () => ({
    meta: [
      { title: "Sell · Pulse POS" },
      { name: "description", content: "Process sales and take payments." },
    ],
  }),
  component: PosPage,
});

function PosPage() {
  const token = useAuth((s) => s.accessToken);
  const user = useAuth((s) => s.user);
  const hydrate = usePosConfig((s) => s.hydrate);
  const hydrateSellContext = useSellContext((s) => s.hydrate);
  const canOverrideRegos = Boolean(user?.permissions.includes("pos.override_regos"));

  useEffect(() => {
    void hydrate(token);
    void hydrateSellContext(token, canOverrideRegos);
  }, [canOverrideRegos, hydrate, hydrateSellContext, token]);

  return (
    <div className={styles.page}>
      <ProductCatalog />
      <CartPanel />
    </div>
  );
}
