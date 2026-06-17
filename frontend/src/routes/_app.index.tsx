import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { ProductCatalog } from "@/components/POS/ProductCatalog";
import { CartPanel } from "@/components/Cart/CartPanel";
import { useAuth } from "@/store/auth";
import { usePosConfig } from "@/store/pos-config";
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
  const hydrate = usePosConfig((s) => s.hydrate);

  useEffect(() => {
    void hydrate(token);
  }, [hydrate, token]);

  return (
    <div className={styles.page}>
      <ProductCatalog />
      <CartPanel />
    </div>
  );
}
