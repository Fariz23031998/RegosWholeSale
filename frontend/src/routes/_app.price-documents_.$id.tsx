import { createFileRoute } from "@tanstack/react-router";
import { PriceDocumentDetailPage } from "@/components/PriceDocuments/PriceDocumentDetailPage";
import { languageService } from "@/services/language";

export const Route = createFileRoute("/_app/price-documents_/$id")({
  head: () => ({
    meta: [
      {
        title: languageService.t("meta.priceDocumentDetailTitle", "Price document · Regos Optom"),
      },
    ],
  }),
  component: function PriceDocumentDetailRoute() {
    const { id } = Route.useParams();
    return <PriceDocumentDetailPage documentId={Number(id)} />;
  },
});
