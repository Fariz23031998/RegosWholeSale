import { create } from "zustand";
import { persist } from "zustand/middleware";
import * as authApi from "@/lib/auth-api";
import { ApiError } from "@/lib/api";
import { languageService } from "@/services/language";
import { sessionFromUser, type SessionDisplay } from "@/lib/user-display";
import type { AuthUser } from "@/types/auth";

type AuthState = {
  accessToken: string | null;
  user: AuthUser | null;
  /** @deprecated Use `session` — kept for POS components */
  cashier: SessionDisplay | null;
  session: SessionDisplay | null;
  isHydrated: boolean;
  setHydrated: () => void;
  setSession: (accessToken: string, user: AuthUser) => void;
  clearSession: () => void;
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => void;
  refreshMe: () => Promise<boolean>;
};

function applyUser(set: (p: Partial<AuthState>) => void, accessToken: string, user: AuthUser) {
  const session = sessionFromUser(user);
  set({
    accessToken,
    user,
    session,
    cashier: session,
  });
}

export const useAuth = create<AuthState>()(
  persist(
    (set, get) => ({
      accessToken: null,
      user: null,
      cashier: null,
      session: null,
      isHydrated: false,
      setHydrated: () => set({ isHydrated: true }),

      setSession: (accessToken, user) => applyUser(set, accessToken, user),

      clearSession: () =>
        set({ accessToken: null, user: null, session: null, cashier: null }),

      login: async (identifier, password) => {
        const res = await authApi.login(identifier, password);
        applyUser(set, res.access_token, res.user);
      },

      logout: () => {
        get().clearSession();
      },

      refreshMe: async () => {
        const token = get().accessToken;
        if (!token) return false;
        try {
          const user = await authApi.fetchMe(token);
          applyUser(set, token, user);
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
      name: "regos-auth",
      partialize: (s) => ({ accessToken: s.accessToken, user: s.user }),
      onRehydrateStorage: () => (state) => {
        if (state?.user && state.accessToken) {
          const session = sessionFromUser(state.user);
          state.session = session;
          state.cashier = session;
        }
        state?.setHydrated();
      },
    },
  ),
);

export function isAuthenticated(): boolean {
  return Boolean(useAuth.getState().accessToken);
}

export function formatAuthError(
  err: unknown,
  fallback = languageService.t("errors.generic", "Something went wrong"),
): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}
