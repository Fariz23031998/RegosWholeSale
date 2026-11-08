import { createFileRoute } from "@tanstack/react-router";
import { PartnerCatalog } from "@/components/PartnerApp/PartnerCatalog";

export const Route = createFileRoute("/partner/$publicKey/")({
  component: PartnerCatalog,
});
