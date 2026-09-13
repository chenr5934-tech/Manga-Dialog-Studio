import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Relative asset paths make the static build work on GitHub Pages project sites.
  base: "./",
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return undefined;
          }

          if (id.includes("jspdf")) {
            return "jspdf-vendor";
          }

          if (id.includes("html2canvas") || id.includes("dompurify")) {
            return "html-export-vendor";
          }

          if (id.includes("react-konva") || id.includes("/konva/") || id.includes("use-image")) {
            return "canvas-vendor";
          }

          if (id.includes("react") || id.includes("scheduler")) {
            return "react-vendor";
          }

          if (id.includes("zustand") || id.includes("fast-json-patch") || id.includes("uuid")) {
            return "editor-vendor";
          }

          return "vendor";
        }
      }
    }
  },
  server: {
    port: 5173,
    // 预设库走本地服务的文件接口，开发模式下需要转发
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8737",
        changeOrigin: true
      }
    }
  }
});
