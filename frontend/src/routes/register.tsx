import { createFileRoute, redirect } from "@tanstack/react-router";
import { RegisterScreen } from "@/components/Auth/RegisterScreen";
import { isAuthenticated } from "@/store/auth";

export const Route = createFileRoute("/register")({
  beforeLoad: () => {
    if (typeof window !== "undefined" && isAuthenticated()) {
      throw redirect({ to: "/" });
    }
  },
  head: () => ({
    meta: [
      { title: "Register · Regos Wholesale" },
      { name: "description", content: "Create a company account." },
    ],
  }),
  component: RegisterScreen,
});
