import { create } from "zustand";
import { persist } from "zustand/middleware";
import { ApiError } from "@/lib/api";
import * as api from "@/lib/platform-api";
import type { PlatformAdmin } from "@/lib/platform-api";

type PlatformAuthState = {
  accessToken: string | null;
  admin: PlatformAdmin | null;
  isHydrated: boolean;
  setHydrated: () => void;
  setSession: (accessToken: string, admin: PlatformAdmin) => void;
  clearSession: () => void;
  login: (login: string, password: string) => Promise<void>;
  logout: () => void;
  refreshMe: () => Promise<boolean>;
};

export const usePlatformAuth = create<PlatformAuthState>()(
  persist(
    (set, get) => ({
      accessToken: null,
      admin: null,
      isHydrated: false,
      setHydrated: () => set({ isHydrated: true }),

      setSession: (accessToken, admin) => set({ accessToken, admin }),

      clearSession: () => set({ accessToken: null, admin: null }),

      login: async (login, password) => {
        const res = await api.platformLogin(login, password);
        set({ accessToken: res.access_token, admin: res.admin });
      },

      logout: () => get().clearSession(),

      refreshMe: async () => {
        const token = get().accessToken;
        if (!token) return false;
        try {
          const admin = await api.fetchPlatformMe(token);
          set({ admin });
          return true;
        } catch (e) {
          if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
            get().clearSession();
          }
          return false;
        }
      },
    }),
    {
      name: "regos-platform-auth",
      partialize: (s) => ({ accessToken: s.accessToken, admin: s.admin }),
      onRehydrateStorage: () => (state) => state?.setHydrated(),
    },
  ),
);

export function waitForPlatformAuthHydration(): Promise<void> {
  if (usePlatformAuth.getState().isHydrated) return Promise.resolve();
  return new Promise((resolve) => {
    const unsub = usePlatformAuth.persist.onFinishHydration(() => {
      unsub();
      resolve();
    });
    setTimeout(() => {
      unsub();
      if (!usePlatformAuth.getState().isHydrated) {
        usePlatformAuth.getState().setHydrated();
      }
      resolve();
    }, 300);
  });
}
