import { createFileRoute } from "@tanstack/react-router";
import { PartnerPaymentsPage } from "@/components/PartnerApp/PartnerRecords";

export const Route = createFileRoute("/partner/$publicKey/payments")({
  component: PartnerPaymentsPage,
});
