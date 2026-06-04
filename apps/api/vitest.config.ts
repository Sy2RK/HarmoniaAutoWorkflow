import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@harmonia/shared": resolve(__dirname, "../../packages/shared/src/index.ts")
    }
  },
  test: {
    environment: "node"
  }
});
