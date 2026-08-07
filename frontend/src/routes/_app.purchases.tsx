import { createFileRoute } from "@tanstack/react-router";
import { StockDocsPage } from "@/components/StockDocs/StockDocsPage";
import { languageService } from "@/services/language";

export const Route = createFileRoute("/_app/purchases")({
  head: () => ({
    meta: [
      { title: languageService.t("meta.purchasesTitle", "Purchases · Regos Optom") },
      {
        name: "description",
        content: languageService.t(
          "meta.purchasesDescription",
          "View and manage purchase documents.",
        ),
      },
    ],
  }),
  component: () => <StockDocsPage kind="purchase" />,
});
