import { createFileRoute } from "@tanstack/react-router";
import { StockDocDetailPage } from "@/components/StockDocs/StockDocDetailPage";
import { languageService } from "@/services/language";

export const Route = createFileRoute("/_app/inventories_/$id")({
  head: () => ({
    meta: [
      {
        title: languageService.t("meta.inventoryDetailTitle", "Inventory · Regos Optom"),
      },
    ],
  }),
  component: function InventoryDetailRoute() {
    const { id } = Route.useParams();
    return <StockDocDetailPage kind="inventory" documentId={Number(id)} />;
  },
});
