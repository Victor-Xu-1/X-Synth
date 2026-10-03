// Plugins
import { fileURLToPath, URL } from "node:url";
import { readFileSync } from "node:fs";
import vue from "@vitejs/plugin-vue";
import vuetify, { transformAssetUrls } from "vite-plugin-vuetify";

// Utilities
import { defineConfig } from "vite";

const productApiPtr = {
  target: process.env.VITE_X_SYNTH_API_TARGET || "http://127.0.0.1:8769",
  changeOrigin: true,
  ws: true,
  secure: true,
};


// https://vitejs.dev/config/
export default defineConfig({
  define: {
    __X_SYNTH_VERSION__: JSON.stringify(readFileSync(new URL("../../VERSION", import.meta.url), "utf8").trim()),
  },
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
  base: "/",
  server: {
    host: "127.0.0.1",
    port: 3000,
    proxy: {
      "/synon-api/": productApiPtr,
      "/api/": productApiPtr,
    },
  },
  optimizeDeps: {
    exclude: ["vuetify"],
  },
});
