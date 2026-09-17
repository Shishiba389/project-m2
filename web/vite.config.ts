import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // GitHub Pages serves a project site under /<repo>/, and this build is
  // published to two of them. BASE_PATH picks the other one, with or without
  // slashes — Git Bash on Windows rewrites a leading "/" into an absolute
  // Windows path, so "BASE_PATH=minima-resize" has to work too:
  //   BASE_PATH=minima-resize npm run build
  base: `/${(process.env.BASE_PATH ?? "project-m2").replace(/^\/+|\/+$/g, "")}/`,
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
  build: {
    outDir: "../docs", emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-dom/client"],
          radix: ["radix-ui"],
          icons: ["lucide-react"],
        },
      },
    },
  },
});
