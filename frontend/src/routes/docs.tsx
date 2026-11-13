import { createFileRoute } from "@tanstack/react-router";
import { DocsPage } from "@/components/Docs/DocsPage";
import { languageService } from "@/services/language";

export const Route = createFileRoute("/docs")({
  head: () => ({
    meta: [
      {
        title: languageService.t("meta.docsTitle", "Documentation · Regos Optom"),
      },
      {
        name: "description",
        content: languageService.t(
          "meta.docsDescription",
          "Public documentation for Regos Optom wholesale POS.",
        ),
      },
    ],
  }),
  component: DocsPage,
});
