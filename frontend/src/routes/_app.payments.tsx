import { createFileRoute } from "@tanstack/react-router";
import { PaymentsPage } from "@/components/Payments/PaymentsPage";
import { languageService } from "@/services/language";

export const Route = createFileRoute("/_app/payments")({
  head: () => ({
    meta: [
      { title: languageService.t("meta.paymentsTitle", "Payments · Regos Optom") },
      {
        name: "description",
        content: languageService.t(
          "meta.paymentsDescription",
          "Create and manage income and outcome payment documents.",
        ),
      },
    ],
  }),
  component: PaymentsPage,
});
