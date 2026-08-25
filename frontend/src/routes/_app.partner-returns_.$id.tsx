import { createFileRoute } from "@tanstack/react-router";
import { StockDocDetailPage } from "@/components/StockDocs/StockDocDetailPage";
import { languageService } from "@/services/language";

export const Route = createFileRoute("/_app/partner-returns_/$id")({
  head: () => ({
    meta: [
      {
        title: languageService.t(
          "meta.partnerReturnDetailTitle",
          "Return to partner · Regos Optom",
        ),
      },
    ],
  }),
  component: function PartnerReturnDetailRoute() {
    const { id } = Route.useParams();
    return <StockDocDetailPage kind="return_to_partner" documentId={Number(id)} />;
  },
});
