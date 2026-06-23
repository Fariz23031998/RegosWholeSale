// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
// @cloudflare/vite-plugin builds from this — wrangler.jsonc main alone is insufficient.
const nginxDeploy = process.env.VITE_DEPLOY_TARGET === "nginx";

export default defineConfig({
  // Cloudflare Workers build is default (Lovable). Set VITE_DEPLOY_TARGET=nginx for VPS static hosting.
  cloudflare: !nginxDeploy,
  tanstackStart: {
    server: { entry: "server" },
    ...(nginxDeploy
      ? {
          prerender: {
            enabled: true,
            crawlLinks: true,
            failOnError: true,
          },
          spa: {
            enabled: true,
            prerender: {
              outputPath: "/index.html",
            },
          },
        }
      : {}),
  },
});
