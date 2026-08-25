import { createFileRoute } from "@tanstack/react-router";
import { StockDocDetailPage } from "@/components/StockDocs/StockDocDetailPage";
import { languageService } from "@/services/language";

export const Route = createFileRoute("/_app/movements_/$id")({
  head: () => ({
    meta: [
      {
        title: languageService.t("meta.movementDetailTitle", "Movement · Regos Optom"),
      },
    ],
  }),
  component: function MovementDetailRoute() {
    const { id } = Route.useParams();
    return <StockDocDetailPage kind="movement" documentId={Number(id)} />;
  },
});
