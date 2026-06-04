import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@harmonia/shared": resolve(__dirname, "../../packages/shared/src/index.ts")
    }
  },
  server: {
    port: 5173
  }
});
