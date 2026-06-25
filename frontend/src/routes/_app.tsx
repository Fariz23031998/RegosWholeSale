import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Shell } from "@/components/Layout/Shell";
import { useAuth, waitForAuthHydration } from "@/store/auth";

export const Route = createFileRoute("/_app")({
  beforeLoad: async () => {
    // Auth lives in localStorage; defer the guard to the client after hydration.
    if (typeof window === "undefined") return;

    await waitForAuthHydration();

    const { accessToken, refreshMe } = useAuth.getState();
    if (!accessToken) {
      throw redirect({ to: "/login" });
    }

    const ok = await refreshMe();
    if (!ok && !useAuth.getState().accessToken) {
      throw redirect({ to: "/login" });
    }
  },
  component: AppLayout,
});

function AppLayout() {
  const accessToken = useAuth((s) => s.accessToken);
  const isHydrated = useAuth((s) => s.isHydrated);
  const navigate = useNavigate();

  useEffect(() => {
    if (!isHydrated || accessToken) return;
    void navigate({ to: "/login", replace: true });
  }, [accessToken, isHydrated, navigate]);

  if (!isHydrated || !accessToken) {
    return null;
  }

  return <Shell />;
}
