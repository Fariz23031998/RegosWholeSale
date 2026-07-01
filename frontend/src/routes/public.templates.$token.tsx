import { createFileRoute } from "@tanstack/react-router";
import { PublicTemplatePage } from "@/components/Receipt/PublicTemplatePage";
import { languageService } from "@/services/language";

export const Route = createFileRoute("/public/templates/$token")({
  head: () => ({
    meta: [
      {
        title: languageService.t("meta.publicDocumentTitle", "Shared document · Regos Optom"),
      },
      {
        name: "description",
        content: languageService.t(
          "meta.publicDocumentDescription",
          "View shared sale or return details and print the receipt.",
        ),
      },
    ],
  }),
  component: PublicTemplateRoute,
});

function PublicTemplateRoute() {
  const { token } = Route.useParams();
  return <PublicTemplatePage publicToken={token} />;
}
