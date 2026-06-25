import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// During `npm run dev`, the Vite dev server (5173) proxies /api to the
// Express + Turso server (8787). In production, Express serves the built
// frontend AND /api from the same origin, so no proxy is needed.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { "/api": "http://localhost:8787" } },
});
