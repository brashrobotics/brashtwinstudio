/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: { chunkSizeWarningLimit: 700 },
  server: { port: 4392, strictPort: true },
  preview: { port: 4393, strictPort: true },
  test: { environment: "jsdom", restoreMocks: true },
});
