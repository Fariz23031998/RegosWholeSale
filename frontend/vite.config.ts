// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const selectorShim = path.resolve(rootDir, "src/shims/use-sync-external-store-with-selector.js");

// mxik publishes .map files that point at unpublished lib/*.ts sources.
// Drop those maps so Vite does not warn on every dev request.
function ignoreMxikMissingSourcemaps() {
  return {
    name: "ignore-mxik-missing-sourcemaps",
    enforce: "pre" as const,
    async load(id: string) {
      const file = id.split("?")[0];
      const normalized = file.replaceAll("\\", "/");
      if (!normalized.includes("/node_modules/mxik/") || !normalized.endsWith(".js")) return null;
      const code = await fs.readFile(file, "utf8");
      return {
        code: code.replace(/\/\/# sourceMappingURL=\S+/g, ""),
        map: null,
      };
    },
  };
}

// Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
// @cloudflare/vite-plugin builds from this — wrangler.jsonc main alone is insufficient.
const nginxDeploy = process.env.VITE_DEPLOY_TARGET === "nginx";

export default defineConfig({
  // Cloudflare Workers build is default (Lovable). Set VITE_DEPLOY_TARGET=nginx for VPS static hosting.
  vite: {
    server: {
      // ngrok hostnames change on every tunnel restart.
      allowedHosts: [".ngrok-free.app", ".ngrok-free.dev", ".ngrok.io", ".ngrok.app"],
      proxy: {
        "/api": {
          target: "http://127.0.0.1:8000",
          changeOrigin: true,
        },
      },
    },
    plugins: [ignoreMxikMissingSourcemaps()],
    resolve: {
      alias: {
        "use-sync-external-store/shim/with-selector.js": selectorShim,
        "use-sync-external-store/shim/with-selector": selectorShim,
      },
    },
    // mxik ships extensionless ESM imports, which Node cannot resolve during SSR.
    ssr: {
      noExternal: ["mxik"],
    },
  },
  cloudflare: nginxDeploy ? false : undefined,
  tanstackStart: {
    server: { 
      entry: "server",
    },
    ...(nginxDeploy
      ? {
          prerender: {
            enabled: true,
            // Static nginx hosting only needs the SPA shell; crawling auth routes
            // triggers SSR during build and can fail (e.g. /login 500).
            crawlLinks: false,
            failOnError: false,
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
