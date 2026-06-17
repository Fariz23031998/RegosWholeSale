import { createFileRoute } from "@tanstack/react-router";
import { ReturnsPage } from "@/components/Returns/ReturnsPage";

export const Route = createFileRoute("/_app/returns")({
  head: () => ({
    meta: [
      { title: "Returns · Pulse POS" },
      { name: "description", content: "Process refunds from previous sales." },
    ],
  }),
  component: ReturnsPage,
});
