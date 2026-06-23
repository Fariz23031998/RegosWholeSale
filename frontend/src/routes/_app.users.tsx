import { createFileRoute } from "@tanstack/react-router";
import { UsersPage } from "@/components/Users/UsersPage";
import { languageService } from "@/services/language";

export const Route = createFileRoute("/_app/users")({
  head: () => ({
    meta: [
      { title: languageService.t("meta.usersTitle", "Users · Regos Optom") },
      {
        name: "description",
        content: languageService.t("meta.usersDescription", "Manage company users and permissions."),
      },
    ],
  }),
  component: UsersPage,
});
