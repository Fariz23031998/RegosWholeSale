import { createFileRoute } from "@tanstack/react-router";
import { StockDocsPage } from "@/components/StockDocs/StockDocsPage";
import { languageService } from "@/services/language";

export const Route = createFileRoute("/_app/inventories")({
  head: () => ({
    meta: [
      { title: languageService.t("meta.inventoriesTitle", "Inventories · Regos Optom") },
      {
        name: "description",
        content: languageService.t(
          "meta.inventoriesDescription",
          "View and count inventory documents.",
        ),
      },
    ],
  }),
  component: () => <StockDocsPage kind="inventory" />,
});
