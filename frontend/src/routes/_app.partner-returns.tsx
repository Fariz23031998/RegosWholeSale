import { createFileRoute } from "@tanstack/react-router";
import { StockDocsPage } from "@/components/StockDocs/StockDocsPage";
import { languageService } from "@/services/language";

export const Route = createFileRoute("/_app/partner-returns")({
  head: () => ({
    meta: [
      {
        title: languageService.t(
          "meta.partnerReturnsTitle",
          "Returns to partner · Regos Optom",
        ),
      },
      {
        name: "description",
        content: languageService.t(
          "meta.partnerReturnsDescription",
          "View and manage returns to partner documents.",
        ),
      },
    ],
  }),
  component: () => <StockDocsPage kind="return_to_partner" />,
});
