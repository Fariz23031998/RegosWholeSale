import { createRootRoute, createRoute, createRouter, Outlet, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { AdminsPage } from "@/pages/AdminsPage";
import { CompaniesPage } from "@/pages/CompaniesPage";
import { CompanyDetailPage } from "@/pages/CompanyDetailPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { PaymentsPage } from "@/pages/PaymentsPage";
import { LoginPage } from "@/pages/LoginPage";
import { usePlatformAuth, waitForPlatformAuthHydration } from "@/store/platform-auth";

const rootRoute = createRootRoute();

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  beforeLoad: async () => {
    await waitForPlatformAuthHydration();
    if (usePlatformAuth.getState().accessToken) {
      throw redirect({ to: "/" });
    }
  },
  component: LoginPage,
});

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app",
  beforeLoad: async () => {
    await waitForPlatformAuthHydration();
    const { accessToken, refreshMe } = usePlatformAuth.getState();
    if (!accessToken) {
      throw redirect({ to: "/login" });
    }
    const ok = await refreshMe();
    if (!ok && !usePlatformAuth.getState().accessToken) {
      throw redirect({ to: "/login" });
    }
  },
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});

const dashboardRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/",
  component: DashboardPage,
});

const companiesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/companies",
  component: CompaniesPage,
});

const companyDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/companies/$id",
  component: CompanyDetailPage,
});

const adminsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/admins",
  component: AdminsPage,
});

const paymentsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/payments",
  component: PaymentsPage,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  appRoute.addChildren([
    dashboardRoute,
    companiesRoute,
    companyDetailRoute,
    adminsRoute,
    paymentsRoute,
  ]),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
