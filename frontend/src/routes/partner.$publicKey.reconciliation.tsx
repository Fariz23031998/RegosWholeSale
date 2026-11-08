import { createFileRoute } from "@tanstack/react-router";
import { PartnerReconciliationPage } from "@/components/PartnerApp/PartnerRecords";

export const Route = createFileRoute("/partner/$publicKey/reconciliation")({
  component: PartnerReconciliationPage,
});
