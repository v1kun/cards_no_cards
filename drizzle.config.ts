import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit configuration.
 *
 * Only used for generating migration SQL from the schema
 * (`npm run db:generate`). Applying migrations at runtime is done by the
 * app's own libSQL migrator (see src/server/db/migrate.ts), so no
 * database driver is required here.
 */
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  strict: true,
  verbose: true,
});
