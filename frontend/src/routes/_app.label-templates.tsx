import { createFileRoute } from "@tanstack/react-router";
import { LabelTemplatesPage } from "@/components/Settings/LabelTemplatesPage";
import { languageService } from "@/services/language";

export const Route = createFileRoute("/_app/label-templates")({
  head: () => ({
    meta: [
      {
        title: languageService.t("meta.labelTemplatesTitle", "Label templates · Regos Optom"),
      },
      {
        name: "description",
        content: languageService.t(
          "meta.labelTemplatesDescription",
          "Create and edit HTML product label templates.",
        ),
      },
    ],
  }),
  component: LabelTemplatesPage,
});
