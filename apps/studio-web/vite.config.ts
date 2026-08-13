/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 700,
  },
  server: {
    port: 4390,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:4380",
      "/health": "http://127.0.0.1:4380",
    },
  },
  preview: {
    port: 4391,
    strictPort: true,
  },
  test: {
    environment: "jsdom",
    restoreMocks: true,
  },
});
