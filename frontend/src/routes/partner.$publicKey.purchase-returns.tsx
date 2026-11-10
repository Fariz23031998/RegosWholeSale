import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { PartnerStockDocumentPage } from "@/components/PartnerApp/PartnerRecords";

const searchSchema = z.object({
  id: z.number().optional(),
});

export const Route = createFileRoute("/partner/$publicKey/purchase-returns")({
  validateSearch: searchSchema,
  component: PurchaseReturnsRoute,
});

function PurchaseReturnsRoute() {
  const { publicKey } = Route.useParams();
  const { id } = Route.useSearch();
  const navigate = useNavigate();
  return (
    <PartnerStockDocumentPage
      kind="wholesale-return"
      titleKey="partnerApp.purchaseReturn"
      titleFallback="Purchase returns"
      documentId={id}
      onOpen={(documentId) =>
        void navigate({
          to: "/partner/$publicKey/purchase-returns",
          params: { publicKey },
          search: { id: documentId },
        })
      }
      onBack={() =>
        void navigate({ to: "/partner/$publicKey/purchase-returns", params: { publicKey }, search: {} })
      }
    />
  );
}
