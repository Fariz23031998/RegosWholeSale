import { createFileRoute } from "@tanstack/react-router";
import { StockDocsPage } from "@/components/StockDocs/StockDocsPage";
import { languageService } from "@/services/language";

export const Route = createFileRoute("/_app/movements")({
  head: () => ({
    meta: [
      { title: languageService.t("meta.movementsTitle", "Movements · Regos Optom") },
      {
        name: "description",
        content: languageService.t(
          "meta.movementsDescription",
          "View and manage stock movement documents.",
        ),
      },
    ],
  }),
  component: () => <StockDocsPage kind="movement" />,
});
