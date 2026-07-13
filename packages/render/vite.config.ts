/// <reference types="vitest/config" />
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    rollupOptions: { input: { render: "render.html", preview: "preview.html" } },
  },
  test: { environment: "jsdom" },
});
