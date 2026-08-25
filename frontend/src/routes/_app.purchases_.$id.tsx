import { createFileRoute } from "@tanstack/react-router";
import { StockDocDetailPage } from "@/components/StockDocs/StockDocDetailPage";
import { languageService } from "@/services/language";

export const Route = createFileRoute("/_app/purchases_/$id")({
  head: () => ({
    meta: [
      {
        title: languageService.t("meta.purchaseDetailTitle", "Purchase · Regos Optom"),
      },
    ],
  }),
  component: function PurchaseDetailRoute() {
    const { id } = Route.useParams();
    return <StockDocDetailPage kind="purchase" documentId={Number(id)} />;
  },
});
