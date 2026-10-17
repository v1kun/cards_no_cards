# Cards No Cards

Personal **Spanish vocabulary-retention PWA**. Import free-form lesson notes,
turn them into structured vocabulary with AI, and review with short adaptive
practice sessions. Dark theme, optimized to install on iPhone.

> Status: early development. This repository currently contains the Phase 0
> application skeleton (Next.js + TypeScript, tooling, CI, env validation, and a
> mock AI provider). See `IMPLEMENTATION_PLAN.md` for the roadmap and
> `TECHNICAL_SPEC.md` for the technical design. `PROJECT_DECISIONS.md` holds the
> authoritative MVP decisions.

## Prerequisites

- Node.js `22` (see `.nvmrc`; `nvm use` to match)
- npm `11+`
- Docker (optional; used for the local environment in a later phase)

## Getting started

```bash
# 1. Install dependencies
npm install

# 2. Create a local env file from the template (names/placeholders only)
cp .env.example .env.local

# 3. Start the dev server
npm run dev
```

Then open http://localhost:3000. A public health check is available at
http://localhost:3000/api/health.

Local development runs with no AWS credentials and no paid AI calls:
`AI_PROVIDER=mock` is the default.

## Local development with Docker

The database is file-based **SQLite** — there is no separate database
server. The app container stores the database file on a persistent named
volume (`cards-data`), so local data survives container restarts and
rebuilds. Docker/Podman is optional; the `npm run dev` flow above does
not require it.

```bash
# Production-like container (Next.js standalone server)
docker compose up --build app

# Hot-reload dev container (mounts the source tree)
docker compose up dev
```

Both expose the app on http://localhost:3000 and a health check on
http://localhost:3000/api/health. The `app` service declares a
container healthcheck against that route.

> The commands use `docker compose`; `podman compose` works the same
> way. Images are intended to be built in CI, not on the deployment host.

### Resetting local data

Local SQLite data lives in the `cards-data` volume (containers) or in
`./local-data` (host `npm run dev`). To reset to an empty database:

```bash
# Containers: remove the app and its data volume
docker compose down -v

# Host dev server: delete the local database files
rm -rf ./local-data
```

After resetting, re-create the schema with `npm run db:migrate` (and, for
containers, on next start).

## Available commands

| Command                | Description                               |
| ---------------------- | ----------------------------------------- |
| `npm run dev`          | Start the Next.js dev server (hot reload) |
| `npm run build`        | Production build                          |
| `npm start`            | Run the production build                  |
| `npm run lint`         | ESLint                                    |
| `npm run format`       | Format with Prettier                      |
| `npm run format:check` | Verify formatting (used in CI)            |
| `npm run typecheck`    | TypeScript strict type check              |
| `npm test`             | Run the Vitest suite once                 |
| `npm run test:watch`   | Run Vitest in watch mode                  |
| `npm run db:generate`  | Generate SQL migrations from the schema   |
| `npm run db:migrate`   | Apply migrations to `DATABASE_URL`        |

## Database

The data layer uses **SQLite** (via libSQL) with **Drizzle ORM**. There is no
separate database server.

- **Schema:** `src/server/db/schema.ts` — profiles, lessons, vocabulary items,
  forms, topics, topic links, word sources, import batches/items, review
  states, attempts, and practice sessions, with indexes and constraints.
- **Migrations:** committed SQL under `drizzle/`. Generate after a schema
  change with `npm run db:generate`; apply with `npm run db:migrate`. Migrations
  are ordered and idempotent — the same files run in local development and
  production.
- **Repositories:** `src/server/repositories/` — typed, ownership-scoped data
  access (every query is filtered by `user_id`). Topic names are normalized to
  avoid duplicates; vocabulary creation (item + forms + topics + source) is
  transactional; archival is preferred over deletion, and hard deletes cascade.

```bash
# After cloning or changing the schema, create/upgrade the local database:
npm run db:migrate
```

## Configuration

All configuration is validated at startup by `src/lib/env`. Missing or invalid
variables fail fast with a clear error. Copy `.env.example` and fill values in
`.env.local`. Key variables:

- `AI_PROVIDER` — `mock` (default) or `openai`
- `OPENAI_API_KEY` — required only when `AI_PROVIDER=openai`
- `DATABASE_URL` — libSQL URL for the SQLite database, e.g.
  `file:./local-data/cards.sqlite`

## Project structure

```text
src/
  app/              Next.js App Router (UI + route handlers)
  lib/env/          Validated environment configuration
  server/ai/        Vendor-neutral AIProvider interface + adapters (mock first)
  server/db/        Drizzle schema, client, and migration runner
  server/repositories/  Typed, ownership-scoped data access
  domain/           Pure domain logic (scheduling, exercises) — added per phase
drizzle/            Generated SQL migrations
tests/
  unit/             Unit tests
  integration/      Database/repository integration tests
```

## Security notes

- **Never commit secrets.** `.env*` files are gitignored; only `.env.example`
  (placeholders) is tracked.
- AI provider keys and auth secrets stay server-side and are never sent to the
  browser.
- The AI model proposes content but is never the source of truth for user data,
  permissions, review state, or scheduling.

## License

See [`LICENSE`](./LICENSE).
