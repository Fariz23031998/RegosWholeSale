import { createFileRoute } from "@tanstack/react-router";
import { PartnerDashboardPage } from "@/components/PartnerApp/PartnerDashboardPage";

export const Route = createFileRoute("/partner/$publicKey/dashboard")({
  component: PartnerDashboardPage,
});
