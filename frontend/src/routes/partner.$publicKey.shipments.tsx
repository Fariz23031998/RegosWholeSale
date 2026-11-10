import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { PartnerStockDocumentPage } from "@/components/PartnerApp/PartnerRecords";

const searchSchema = z.object({
  id: z.number().optional(),
});

export const Route = createFileRoute("/partner/$publicKey/shipments")({
  validateSearch: searchSchema,
  component: ShipmentsRoute,
});

function ShipmentsRoute() {
  const { publicKey } = Route.useParams();
  const { id } = Route.useSearch();
  const navigate = useNavigate();
  return (
    <PartnerStockDocumentPage
      kind="purchase"
      titleKey="partnerApp.wholesale"
      titleFallback="Shipments"
      documentId={id}
      onOpen={(documentId) =>
        void navigate({ to: "/partner/$publicKey/shipments", params: { publicKey }, search: { id: documentId } })
      }
      onBack={() => void navigate({ to: "/partner/$publicKey/shipments", params: { publicKey }, search: {} })}
    />
  );
}
