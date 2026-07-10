import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { Shell } from "@/components/Layout/Shell";
import { usePermissions } from "@/hooks/use-permissions";
import { connectCatalogEvents } from "@/lib/catalog-events";
import { connectSettingsEvents, type SettingsEventNamespace } from "@/lib/settings-events";
import { SETTINGS_QUERY_KEYS, fetchRegosReferenceOptions } from "@/lib/settings-api";
import {
  enqueuePendingSaleSync,
  startPendingSaleSync,
  stopPendingSaleSync,
} from "@/lib/pending-sales-sync";
import { useAuth, waitForAuthHydration } from "@/store/auth";
import { usePendingSales } from "@/store/pending-sales";
import { usePosConfig } from "@/store/pos-config";
import { useSellContext } from "@/store/sell-context";

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
  const queryClient = useQueryClient();
  const accessToken = useAuth((s) => s.accessToken);
  const user = useAuth((s) => s.user);
  const isHydrated = useAuth((s) => s.isHydrated);
  const hydratePendingSales = usePendingSales((s) => s.hydrate);
  const resetPendingSales = usePendingSales((s) => s.reset);
  const pendingSalesHydrated = usePendingSales((s) => s.hydrated);
  const { canChangePosContext } = usePermissions();
  const navigate = useNavigate();
  const settingsEventsRef = useRef<ReturnType<typeof connectSettingsEvents> | null>(null);
  const catalogEventsRef = useRef<ReturnType<typeof connectCatalogEvents> | null>(null);
  const canChangePosContextRef = useRef(canChangePosContext);

  useEffect(() => {
    canChangePosContextRef.current = canChangePosContext;
  }, [canChangePosContext]);

  useEffect(() => {
    if (!isHydrated || !accessToken || !user) {
      stopPendingSaleSync();
      resetPendingSales();
      return;
    }

    void hydratePendingSales(user.id, user.company_id).then(() => {
      startPendingSaleSync(accessToken);
      enqueuePendingSaleSync();
    });

    return () => {
      stopPendingSaleSync();
    };
  }, [
    accessToken,
    hydratePendingSales,
    isHydrated,
    resetPendingSales,
    user?.company_id,
    user?.id,
  ]);

  useEffect(() => {
    if (!isHydrated || accessToken) return;
    void navigate({ to: "/login", replace: true });
  }, [accessToken, isHydrated, navigate]);

  useEffect(() => {
    if (!isHydrated || !accessToken || !user?.company_id) return;

    void fetchRegosReferenceOptions(accessToken, {
      cacheScope: { companyId: user.company_id },
    }).catch(() => undefined);
  }, [accessToken, isHydrated, user?.company_id]);

  useEffect(() => {
    settingsEventsRef.current?.close();
    settingsEventsRef.current = null;

    if (!accessToken || !user?.company_id || !user.id) return;

    const invalidateCompanyNamespace = (namespace: SettingsEventNamespace) => {
      if (namespace === "pos") {
        void queryClient.invalidateQueries({
          queryKey: SETTINGS_QUERY_KEYS.pos(accessToken),
        });
      }
      if (
        namespace === "regos_defaults" ||
        namespace === "regos_token" ||
        namespace === "payment_linking" ||
        namespace === "doc_payment_sale_id"
      ) {
        void queryClient.invalidateQueries({
          queryKey: SETTINGS_QUERY_KEYS.regosBootstrap(accessToken),
        });
      }
      if (namespace === "receipt_templates") {
        void queryClient.invalidateQueries({
          queryKey: SETTINGS_QUERY_KEYS.receiptTemplates(accessToken),
        });
      }
      if (namespace === "exchange_rate_sync") {
        void queryClient.invalidateQueries({
          queryKey: SETTINGS_QUERY_KEYS.exchangeRateSync(accessToken),
        });
      }
    };

    settingsEventsRef.current = connectSettingsEvents(
      accessToken,
      {
        companyId: user.company_id,
        userId: user.id,
      },
      {
        onCompanySettingsUpdated: invalidateCompanyNamespace,
        onEmployeeSettingsUpdated: (namespace) => {
          if (namespace === "pos") {
            void usePosConfig.getState().hydrate(accessToken, {
              force: true,
              userId: user.id,
              companyId: user.company_id,
            });
          }
          if (namespace === "regos_defaults") {
            void useSellContext.getState().hydrate(accessToken, canChangePosContextRef.current(), {
              force: true,
              userId: user.id,
              companyId: user.company_id,
            });
          }
        },
      },
    );

    return () => {
      settingsEventsRef.current?.close();
      settingsEventsRef.current = null;
    };
  }, [accessToken, queryClient, user?.company_id, user?.id]);

  useEffect(() => {
    catalogEventsRef.current?.close();
    catalogEventsRef.current = null;

    if (!accessToken || !user?.company_id || !user.id) return;

    catalogEventsRef.current = connectCatalogEvents(
      accessToken,
      { companyId: user.company_id },
      {
        onReferenceOptionsInvalidated: (kinds) => {
          void useSellContext.getState().refreshReferenceOptions(accessToken, kinds);
          void queryClient.invalidateQueries({
            queryKey: ["regos", "reference-options", accessToken],
          });
        },
      },
    );

    return () => {
      catalogEventsRef.current?.close();
      catalogEventsRef.current = null;
    };
  }, [accessToken, queryClient, user?.company_id, user?.id]);

  if (!isHydrated || !accessToken || !pendingSalesHydrated) {
    return null;
  }

  return <Shell />;
}
