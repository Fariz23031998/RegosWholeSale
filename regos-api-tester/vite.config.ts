import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5175,
    proxy: {
      "/regos-proxy": {
        target: "https://integration.regos.uz",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/regos-proxy/, ""),
        secure: true,
      },
      "/oauth-proxy": {
        target: "https://auth.regos.uz",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/oauth-proxy/, ""),
        secure: true,
      },
    },
  },
});
