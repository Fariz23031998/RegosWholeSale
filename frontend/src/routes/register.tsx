import { createFileRoute, redirect } from "@tanstack/react-router";
import { RegisterScreen } from "@/components/Auth/RegisterScreen";
import { languageService } from "@/services/language";
import { isAuthenticated } from "@/store/auth";

export const Route = createFileRoute("/register")({
  beforeLoad: () => {
    if (typeof window !== "undefined" && isAuthenticated()) {
      throw redirect({ to: "/" });
    }
  },
  head: () => ({
    meta: [
      { title: languageService.t("meta.registerTitle", "Register · Regos Optom") },
      {
        name: "description",
        content: languageService.t("meta.registerDescription", "Create a company account."),
      },
    ],
  }),
  component: RegisterScreen,
});
