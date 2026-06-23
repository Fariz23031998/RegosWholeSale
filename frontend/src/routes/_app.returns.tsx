import { createFileRoute } from "@tanstack/react-router";
import { ReturnsPage } from "@/components/Returns/ReturnsPage";
import { languageService } from "@/services/language";

export const Route = createFileRoute("/_app/returns")({
  head: () => ({
    meta: [
      { title: languageService.t("meta.returnsTitle", "Returns · Regos Optom") },
      {
        name: "description",
        content: languageService.t("meta.returnsDescription", "Process refunds from previous sales."),
      },
    ],
  }),
  component: ReturnsPage,
});
