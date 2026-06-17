import { createFileRoute, redirect } from "@tanstack/react-router";
import { Shell } from "@/components/Layout/Shell";
import { useAuth } from "@/store/auth";

export const Route = createFileRoute("/_app")({
  beforeLoad: async () => {
    if (typeof window === "undefined") return;

    const { accessToken, isHydrated, refreshMe } = useAuth.getState();

    if (!isHydrated) {
      await new Promise<void>((resolve) => {
        const unsub = useAuth.persist.onFinishHydration(() => {
          unsub();
          resolve();
        });
        setTimeout(() => {
          unsub();
          resolve();
        }, 500);
      });
    }

    const token = useAuth.getState().accessToken;
    if (!token) {
      throw redirect({ to: "/login" });
    }

    const ok = await refreshMe();
    if (!ok && !useAuth.getState().accessToken) {
      throw redirect({ to: "/login" });
    }
  },
  component: Shell,
});
