import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { PartnerStockDocumentPage } from "@/components/PartnerApp/PartnerRecords";

const searchSchema = z.object({
  id: z.number().optional(),
});

export const Route = createFileRoute("/partner/$publicKey/shipment-returns")({
  validateSearch: searchSchema,
  component: ShipmentReturnsRoute,
});

function ShipmentReturnsRoute() {
  const { publicKey } = Route.useParams();
  const { id } = Route.useSearch();
  const navigate = useNavigate();
  return (
    <PartnerStockDocumentPage
      kind="purchase-return"
      titleKey="partnerApp.wholesaleReturn"
      titleFallback="Shipment returns"
      documentId={id}
      onOpen={(documentId) =>
        void navigate({
          to: "/partner/$publicKey/shipment-returns",
          params: { publicKey },
          search: { id: documentId },
        })
      }
      onBack={() =>
        void navigate({ to: "/partner/$publicKey/shipment-returns", params: { publicKey }, search: {} })
      }
    />
  );
}
