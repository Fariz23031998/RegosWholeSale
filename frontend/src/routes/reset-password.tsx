import { createFileRoute, redirect } from "@tanstack/react-router";
import { ResetPasswordScreen } from "@/components/Auth/ResetPasswordScreen";
import { isAuthenticated } from "@/store/auth";

export const Route = createFileRoute("/reset-password")({
  beforeLoad: () => {
    if (typeof window !== "undefined" && isAuthenticated()) {
      throw redirect({ to: "/" });
    }
  },
  head: () => ({
    meta: [
      { title: "Reset password · Regos Optom" },
      { name: "description", content: "Reset your account password." },
    ],
  }),
  component: ResetPasswordScreen,
});
