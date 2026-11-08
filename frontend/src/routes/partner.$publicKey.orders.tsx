import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { PartnerOrdersPage } from "@/components/PartnerApp/PartnerRecords";

const searchSchema = z.object({
  placed: z.string().optional(),
});

export const Route = createFileRoute("/partner/$publicKey/orders")({
  validateSearch: searchSchema,
  component: OrdersRoute,
});

function OrdersRoute() {
  const { placed } = Route.useSearch();
  return <PartnerOrdersPage placed={placed} />;
}
