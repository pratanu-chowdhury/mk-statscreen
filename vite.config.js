import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Frontend-only build for Lovable / any static host.
// `npm run build` emits dist/; saved screenings live in the browser's
// localStorage (see src/store.js). To later point the UI at a deployed
// Express + Turso API, set VITE_API_URL at build time — no UI changes needed.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
});
