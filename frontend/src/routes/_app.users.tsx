import { createFileRoute } from "@tanstack/react-router";
import { UsersPage } from "@/components/Users/UsersPage";

export const Route = createFileRoute("/_app/users")({
  head: () => ({
    meta: [
      { title: "Users · Regos Optom" },
      { name: "description", content: "Manage company users and permissions." },
    ],
  }),
  component: UsersPage,
});
