import { createFileRoute } from "@tanstack/react-router";
import { SalesPage } from "@/components/Sales/SalesPage";
import { languageService } from "@/services/language";

export const Route = createFileRoute("/_app/sales")({
  head: () => ({
    meta: [
      { title: languageService.t("meta.salesTitle", "Sales · Regos Optom") },
      {
        name: "description",
        content: languageService.t("meta.salesDescription", "View sales history and reprint receipts."),
      },
    ],
  }),
  component: SalesPage,
});
