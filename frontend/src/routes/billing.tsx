import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";
import { BillingPage } from "@/components/Billing/BillingPage";
import { languageService } from "@/services/language";
import { waitForAuthHydration, useAuth } from "@/store/auth";

const billingSearchSchema = z.object({
  order_id: z.string().optional(),
});

export const Route = createFileRoute("/billing")({
  validateSearch: billingSearchSchema,
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    await waitForAuthHydration();
    if (!useAuth.getState().accessToken) {
      throw redirect({ to: "/login", search: { subscription: "expired" } });
    }
  },
  head: () => ({
    meta: [
      {
        title: languageService.t("meta.billingTitle", "Billing · Regos Optom"),
      },
      {
        name: "description",
        content: languageService.t(
          "meta.billingDescription",
          "Renew your Regos Optom subscription.",
        ),
      },
    ],
  }),
  component: BillingPage,
});
