import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import * as authApi from "@/lib/auth-api";
import { ApiError } from "@/lib/api";
import { languageService } from "@/services/language";
import { sessionFromUser, type SessionDisplay } from "@/lib/user-display";
import type { AuthUser } from "@/types/auth";

function createMemoryStorage(): StateStorage {
  const map = new Map<string, string>();
  return {
    getItem: (name) => map.get(name) ?? null,
    setItem: (name, value) => {
      map.set(name, value);
    },
    removeItem: (name) => {
      map.delete(name);
    },
  };
}

/**
 * Zustand persist skips attaching `api.persist` when storage is unavailable.
 * Safari private mode / blocked storage can throw on localStorage access.
 */
function createAuthStorage(): StateStorage {
  if (typeof window === "undefined") {
    return createMemoryStorage();
  }
  try {
    const storage = window.localStorage;
    const probeKey = "__regos_auth_probe__";
    storage.setItem(probeKey, "1");
    storage.removeItem(probeKey);
    return storage;
  } catch {
    return createMemoryStorage();
  }
}

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
            if (e.code === "SUBSCRIPTION_EXPIRED" && typeof window !== "undefined") {
              window.location.href = "/login?subscription=expired";
            }
          }
          return false;
        }
      },
    }),
    {
      name: "regos-auth",
      storage: createJSONStorage(() => createAuthStorage()),
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

/** Wait until persisted auth state has been restored from storage. */
export function waitForAuthHydration(): Promise<void> {
  if (useAuth.getState().isHydrated) {
    return Promise.resolve();
  }

  const persistApi = useAuth.persist;

  if (!persistApi || typeof persistApi.onFinishHydration !== "function") {
    useAuth.getState().setHydrated();
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    const unsub = persistApi.onFinishHydration(() => {
      unsub();
      resolve();
    });

    if (useAuth.getState().isHydrated) {
      unsub();
      resolve();
      return;
    }

    setTimeout(() => {
      unsub();
      if (!useAuth.getState().isHydrated) {
        useAuth.getState().setHydrated();
      }
      resolve();
    }, 500);
  });
}

export function formatAuthError(
  err: unknown,
  fallback = languageService.t("errors.generic", "Something went wrong"),
): string {
  if (err instanceof ApiError) {
    if (err.code === "SUBSCRIPTION_EXPIRED") {
      return languageService.t(
        "auth.subscriptionExpired",
        "Your trial has ended. Contact support to continue using the service.",
      );
    }
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return fallback;
}
