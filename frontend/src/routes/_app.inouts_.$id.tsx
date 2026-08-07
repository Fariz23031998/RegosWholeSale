import { createFileRoute } from "@tanstack/react-router";
import { StockDocDetailPage } from "@/components/StockDocs/StockDocDetailPage";
import { languageService } from "@/services/language";

export const Route = createFileRoute("/_app/inouts_/$id")({
  head: () => ({
    meta: [
      {
        title: languageService.t("meta.inoutDetailTitle", "In/Out · Regos Optom"),
      },
    ],
  }),
  component: function InoutDetailRoute() {
    const { id } = Route.useParams();
    return <StockDocDetailPage kind="inout" documentId={Number(id)} />;
  },
});
