// Plugins
import { fileURLToPath, URL } from "node:url";
import vue from "@vitejs/plugin-vue";
import vuetify, { transformAssetUrls } from "vite-plugin-vuetify";

// Utilities
import { defineConfig } from "vite";

const fastapiGatewayPtr = {
  target: process.env.VITE_FASTAPI_TARGET || "http://127.0.0.1:9100",
  changeOrigin: true,
  ws: true,
  secure: true,
};

const synonOrchestratorPtr = {
  target: process.env.VITE_SYNON_ORCHESTRATOR_TARGET || "http://127.0.0.1:8790",
  changeOrigin: true,
  secure: true,
};

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    vue({
      template: { transformAssetUrls },
    }),
    // https://github.com/vuetifyjs/vuetify-loader/tree/next/packages/vite-plugin
    vuetify({
      autoImport: true,
      styles: {
        configFile: "src/styles/settings.scss",
      },
    }),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
    extensions: [".js", ".json", ".jsx", ".mjs", ".ts", ".tsx", ".vue"],
  },
  base: "./",
  server: {
    host: "127.0.0.1",
    port: 3000,
    proxy: {
      "/synon-api/": synonOrchestratorPtr,
      "/api/": fastapiGatewayPtr,
    },
  },
  optimizeDeps: {
    exclude: ["vuetify"],
  },
});
