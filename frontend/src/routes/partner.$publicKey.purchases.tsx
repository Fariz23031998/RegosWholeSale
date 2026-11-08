import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { PartnerDocumentPage } from "@/components/PartnerApp/PartnerRecords";

const searchSchema = z.object({
  id: z.number().optional(),
});

export const Route = createFileRoute("/partner/$publicKey/purchases")({
  validateSearch: searchSchema,
  component: PurchasesRoute,
});

function PurchasesRoute() {
  const { publicKey } = Route.useParams();
  const { id } = Route.useSearch();
  const navigate = useNavigate();
  return (
    <PartnerDocumentPage
      kind="purchase"
      titleKey="partnerApp.purchase"
      titleFallback="Purchases"
      documentId={id}
      onOpen={(documentId) =>
        void navigate({ to: "/partner/$publicKey/purchases", params: { publicKey }, search: { id: documentId } })
      }
      onBack={() => void navigate({ to: "/partner/$publicKey/purchases", params: { publicKey }, search: {} })}
    />
  );
}
