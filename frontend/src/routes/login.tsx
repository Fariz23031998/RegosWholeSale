import { createFileRoute, redirect } from "@tanstack/react-router";
import { LoginScreen } from "@/components/Auth/LoginScreen";
import { isAuthenticated } from "@/store/auth";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>) => ({
    reset: typeof search.reset === "string" ? search.reset : undefined,
  }),
  beforeLoad: () => {
    if (typeof window !== "undefined" && isAuthenticated()) {
      throw redirect({ to: "/" });
    }
  },
  head: () => ({
    meta: [
      { title: "Sign in · Regos Wholesale" },
      { name: "description", content: "Sign in to Regos Wholesale." },
    ],
  }),
  component: LoginScreen,
});
