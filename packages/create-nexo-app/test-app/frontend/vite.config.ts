import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "route-logger",
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          if (req.url && (req.url === "/" || (!req.url.includes(".") && !req.url.startsWith("/@")))) {
            console.log(`🌐 [vite] ${req.method} ${req.url}`);
          }
          next();
        });
      }
    }
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true
      }
    }
  }
});
