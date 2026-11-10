import { createFileRoute } from "@tanstack/react-router";
import { PriceDocumentsPage } from "@/components/PriceDocuments/PriceDocumentsPage";
import { languageService } from "@/services/language";

export const Route = createFileRoute("/_app/price-documents")({
  head: () => ({
    meta: [
      { title: languageService.t("meta.priceDocumentsTitle", "Price documents · Regos Optom") },
      {
        name: "description",
        content: languageService.t(
          "meta.priceDocumentsDescription",
          "View price setting documents.",
        ),
      },
    ],
  }),
  component: PriceDocumentsPage,
});
