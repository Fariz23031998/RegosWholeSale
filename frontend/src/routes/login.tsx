import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";
import { LoginScreen } from "@/components/Auth/LoginScreen";
import { getAppHomePath } from "@/lib/app-home";
import { userNeedsBilling } from "@/lib/subscription";
import { languageService } from "@/services/language";
import { isAuthenticated, useAuth, waitForAuthHydration } from "@/store/auth";

const loginSearchSchema = z.object({
  reset: z.string().optional(),
  subscription: z.string().optional(),
});

export const Route = createFileRoute("/login")({
  validateSearch: loginSearchSchema,
  beforeLoad: async () => {
    // Auth lives in localStorage; skip redirect guard during SSR/prerender.
    if (typeof window === "undefined") return;

    await waitForAuthHydration();
    if (isAuthenticated()) {
      const user = useAuth.getState().user;
      if (userNeedsBilling(user)) {
        throw redirect({ to: "/billing" });
      }
      throw redirect({ to: getAppHomePath(user?.permissions) });
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
