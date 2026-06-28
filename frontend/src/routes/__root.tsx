import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";

import { Toaster } from "@/components/ui/sonner";
import { LanguageProvider } from "@/contexts/LanguageContext";
import {
  SITE_NAME,
  SITE_OG_IMAGE_PATH,
  SITE_THEME_COLOR,
} from "@/lib/site";
import { languageService } from "@/services/language";
import appCss from "../styles.css?url";

const t = languageService.t.bind(languageService);

function NotFoundComponent() {

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">
          {t("errors.pageNotFound", "Page not found")}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("errors.pageNotFoundDesc", "The page you're looking for doesn't exist or has been moved.")}
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t("common.goHome", "Go home")}
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {t("errors.pageLoadFailed", "This page didn't load")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t(
            "errors.pageLoadFailedDesc",
            "Something went wrong on our end. You can try refreshing or head back home.",
          )}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t("common.tryAgain", "Try again")}
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            {t("common.goHome", "Go home")}
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      {
        title: languageService.t("meta.appTitle", "Regos Optom — Modern Point of Sale"),
      },
      {
        name: "description",
        content: languageService.t(
          "meta.appDescription",
          "Fast, beautiful point-of-sale for retail. Sell, take payments, track sales.",
        ),
      },
      { name: "author", content: SITE_NAME },
      { name: "application-name", content: SITE_NAME },
      { name: "theme-color", content: SITE_THEME_COLOR },
      {
        property: "og:title",
        content: languageService.t("meta.appTitle", "Regos Optom — Modern Point of Sale"),
      },
      {
        property: "og:description",
        content: languageService.t("meta.appOgDescription", "Fast, beautiful point-of-sale for retail."),
      },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: SITE_NAME },
      { property: "og:image", content: SITE_OG_IMAGE_PATH },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: `${SITE_NAME} logo` },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: languageService.t("meta.appTitle", "Regos Optom — Modern Point of Sale") },
      {
        name: "twitter:description",
        content: languageService.t("meta.appOgDescription", "Fast, beautiful point-of-sale for retail."),
      },
      { name: "twitter:image", content: SITE_OG_IMAGE_PATH },
      { name: "twitter:image:alt", content: `${SITE_NAME} logo` },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", sizes: "any" },
      { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32x32.png" },
      { rel: "icon", type: "image/png", sizes: "16x16", href: "/favicon-16x16.png" },
      { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/site.webmanifest" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body suppressHydrationWarning>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <Outlet />
        <Toaster />
      </LanguageProvider>
    </QueryClientProvider>
  );
}
