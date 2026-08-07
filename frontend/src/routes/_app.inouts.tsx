import { createFileRoute } from "@tanstack/react-router";
import { StockDocsPage } from "@/components/StockDocs/StockDocsPage";
import { languageService } from "@/services/language";

export const Route = createFileRoute("/_app/inouts")({
  head: () => ({
    meta: [
      { title: languageService.t("meta.inoutsTitle", "In/Out · Regos Optom") },
      {
        name: "description",
        content: languageService.t(
          "meta.inoutsDescription",
          "View and manage stock receipt and write-off documents.",
        ),
      },
    ],
  }),
  component: () => <StockDocsPage kind="inout" />,
});
