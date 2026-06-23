import { createFileRoute } from "@tanstack/react-router";
import { DashboardPage } from "@/components/Dashboard/DashboardPage";
import { languageService } from "@/services/language";

export const Route = createFileRoute("/_app/dashboard")({
  head: () => ({
    meta: [
      { title: languageService.t("meta.dashboardTitle", "Dashboard · Regos Optom") },
      {
        name: "description",
        content: languageService.t("meta.dashboardDescription", "Sales analytics and KPIs."),
      },
    ],
  }),
  component: DashboardPage,
});
