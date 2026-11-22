import { createFileRoute } from "@tanstack/react-router";
import { ShiftsPage } from "@/components/Shifts/ShiftsPage";
import { languageService } from "@/services/language";

export const Route = createFileRoute("/_app/shifts")({
  head: () => ({
    meta: [
      { title: languageService.t("meta.shiftsTitle", "Shifts · Regos Optom") },
      {
        name: "description",
        content: languageService.t(
          "meta.shiftsDescription",
          "Open and close cash shifts and track till operations.",
        ),
      },
    ],
  }),
  component: ShiftsPage,
});
