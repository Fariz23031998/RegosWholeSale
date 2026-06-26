import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";
import { LoginScreen } from "@/components/Auth/LoginScreen";
import { languageService } from "@/services/language";
import { isAuthenticated, waitForAuthHydration } from "@/store/auth";

const loginSearchSchema = z.object({
  reset: z.string().optional(),
  subscription: z.string().optional(),
});

export const Route = createFileRoute("/login")({
  validateSearch: loginSearchSchema,
  beforeLoad: async () => {
    await waitForAuthHydration();
    if (isAuthenticated()) {
      throw redirect({ to: "/" });
    }
  },
  head: () => ({
    meta: [
      { title: languageService.t("meta.signInTitle", "Sign in · Regos Optom") },
      {
        name: "description",
        content: languageService.t("meta.signInDescription", "Sign in to Regos Optom."),
      },
    ],
  }),
  component: LoginScreen,
});
