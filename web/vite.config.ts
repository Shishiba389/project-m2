import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // GitHub Pages serves a project site under /<repo>/, and this build is
  // published to two of them. BASE_PATH picks the other one:
  //   BASE_PATH=/minima-resize/ npm run build
  base: process.env.BASE_PATH ?? "/project-m2/",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
  build: { outDir: "../docs", emptyOutDir: true },
});
