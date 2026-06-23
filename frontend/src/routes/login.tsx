import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";
import { LoginScreen } from "@/components/Auth/LoginScreen";
import { isAuthenticated } from "@/store/auth";

const loginSearchSchema = z.object({
  reset: z.string().optional(),
});

export const Route = createFileRoute("/login")({
  validateSearch: loginSearchSchema,
  beforeLoad: () => {
    if (typeof window !== "undefined" && isAuthenticated()) {
      throw redirect({ to: "/" });
    }
  },
  head: () => ({
    meta: [
      { title: "Sign in · Regos Optom" },
      { name: "description", content: "Sign in to Regos Optom." },
    ],
  }),
  component: LoginScreen,
});
