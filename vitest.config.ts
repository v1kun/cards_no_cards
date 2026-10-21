import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      // `server-only` guards against client bundling and throws when loaded
      // outside a server bundler. Tests run server code directly in Node, so
      // the guard is replaced with an empty module.
      "server-only": fileURLToPath(new URL("./tests/stubs/empty.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    globals: true,
    // Route helpers resolve the session through the dev provider in tests.
    env: { AUTH_PROVIDER: "dev" },
  },
});
