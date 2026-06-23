import { createFileRoute } from "@tanstack/react-router";
import { DashboardPage } from "@/components/Dashboard/DashboardPage";

export const Route = createFileRoute("/_app/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard · Regos Optom" },
      { name: "description", content: "Sales analytics and KPIs." },
    ],
  }),
  component: DashboardPage,
});
