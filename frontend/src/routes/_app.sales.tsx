import { createFileRoute } from "@tanstack/react-router";
import { SalesPage } from "@/components/Sales/SalesPage";

export const Route = createFileRoute("/_app/sales")({
  head: () => ({
    meta: [
      { title: "Sales · Regos Optom" },
      { name: "description", content: "View sales history and reprint receipts." },
    ],
  }),
  component: SalesPage,
});
