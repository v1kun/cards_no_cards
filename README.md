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

## Authentication

Authentication is behind a vendor-neutral `AuthProvider` abstraction
(`src/server/auth`), selected by `AUTH_PROVIDER`:

- **`dev` (default):** resolves a stable local session with no real login, so
  the app runs without AWS or Apple. Set the `x-dev-user-id` request header to
  act as a different local user — useful for checking that one user cannot see
  another's data.
- **`cognito`:** Amazon Cognito User Pools with Sign in with Apple as a
  federated identity provider. Wired up in the deployment phase.

Protected route handlers are wrapped with `withAuth` (`src/lib/api/respond.ts`),
which rejects unauthenticated requests with `401` and otherwise provides the
resolved session. All responses use the `{ data, error, requestId }` envelope.

Example protected endpoints:

```bash
# Current profile (created on first access)
curl -s localhost:3000/api/v1/me

# Act as a different local user
curl -s -H 'x-dev-user-id: user-b' localhost:3000/api/v1/me

# Update preferences
curl -s -X PATCH -H 'content-type: application/json' \
  -d '{"preferredLocale":"es","timezone":"Europe/Madrid"}' \
  localhost:3000/api/v1/me

# Sign out / delete account (removes all owned data)
curl -s -X POST localhost:3000/api/v1/auth/signout
curl -s -X DELETE localhost:3000/api/v1/me
```

## Vocabulary and topics

Manage words at [`/vocabulary`](http://localhost:3000/vocabulary): add words,
filter by part of speech, topic, status, due state, and text search, and open a
word to edit it, manage its topics, or archive/restore/delete it. The UI has
explicit empty, loading, error, and retry states and works without any AI.

The UI is backed by versioned JSON endpoints (all under `/api/v1`, all using the
`{ data, error, requestId }` envelope and scoped to the signed-in user):

| Method & path | Purpose |
| --- | --- |
| `GET /vocabulary` | Paginated list; filters: `search`, `partOfSpeech`, `status`, `topicId`, `dueOnly`, `limit`, `offset` |
| `POST /vocabulary` | Create a word with forms, topics, and an optional source |
| `GET /vocabulary/:id` | Word detail: forms, topics, sources, review summary |
| `PATCH /vocabulary/:id` | Update editable fields and/or replace topics |
| `DELETE /vocabulary/:id` | Archive by default; `?hard=true` deletes permanently |
| `POST /vocabulary/:id/restore` | Restore an archived word |
| `GET /vocabulary/:id` after delete | Returns `404` |
| `GET /topics` · `POST /topics` | List topics · create one (normalized, deduplicated) |

Topic names are normalized (case/whitespace) so duplicates collapse, and
inflected forms stay attached to their lemma instead of becoming separate words.

## Import from free text

Paste lesson notes or a word list at [`/import`](http://localhost:3000/import).
The raw text is saved first, then parsed by the configured AI provider into
editable proposals (lemma, translation, part of speech, topics, forms). You can
edit any field, change each proposal's decision (create / merge / skip), and
only then confirm — nothing is written to your vocabulary until you do.

Proposals whose lemma already exists are pre-flagged as likely duplicates and
default to **merge**, so importing the same notes twice enriches existing words
instead of duplicating them. Confirmation runs in a single transaction and is
idempotent: retrying it never creates duplicates, and if it fails your existing
vocabulary is left untouched. If AI parsing fails, the batch is marked `failed`
but the raw text is preserved so it can be reprocessed.

| Method & path | Purpose |
| --- | --- |
| `POST /imports` | Create a batch from `rawText` and parse it (max 20k chars) |
| `GET /imports/:id` | Batch status and current proposals |
| `PATCH /imports/:id` | Edit proposals/decisions before confirming |
| `POST /imports/:id/reprocess` | Re-run AI parsing (e.g. after a failure) |
| `POST /imports/:id/confirm` | Transactionally create/merge selected proposals (idempotent) |

## AI provider

AI features (parsing free text into vocabulary, generating example sentences,
and grading practice answers) sit behind a single vendor-neutral interface,
`AIProvider` (`src/server/ai/types.ts`). Domain code depends only on that
interface and its Zod output schemas — never on a vendor SDK.

- **`mock`** (default): deterministic, offline, used for local dev and every
  test. No API key, no network.
- **`openai`**: real adapter (`src/server/ai/adapters/openai-provider.ts`). The
  OpenAI SDK import, prompt construction, and JSON handling are confined to that
  file. It requests JSON-mode responses and validates them against the shared
  schemas. Switching providers is a configuration/adapter change only.

Every real request goes through shared resilience helpers
(`src/server/ai/resilience.ts`): a per-request timeout, bounded retries with
exponential backoff + jitter (retrying only transient failures such as `429`/5xx
and timeouts), and an optional minimum-interval rate limiter. Malformed model
output is rejected with a typed `AIResponseError`, and partially-valid parse
items are kept but forced into the review queue rather than silently dropped, so
a bad response never corrupts saved vocabulary. Errors are vendor-neutral
(`src/server/ai/errors.ts`).

Configuration (all server-side): `AI_PROVIDER`, `OPENAI_API_KEY` (required when
`AI_PROVIDER=openai`), `AI_MODEL`, `AI_BASE_URL`, `AI_REQUEST_TIMEOUT_MS`,
`AI_MAX_RETRIES`, and `AI_MIN_REQUEST_INTERVAL_MS`.

## Configuration

All configuration is validated at startup by `src/lib/env`. Missing or invalid
variables fail fast with a clear error. Copy `.env.example` and fill values in
`.env.local`. Key variables:

- `AI_PROVIDER` — `mock` (default) or `openai`
- `OPENAI_API_KEY` — required only when `AI_PROVIDER=openai`
- `AI_MODEL` / `AI_BASE_URL` — optional model id and OpenAI-compatible base URL
- `AI_REQUEST_TIMEOUT_MS` / `AI_MAX_RETRIES` / `AI_MIN_REQUEST_INTERVAL_MS` —
  resilience tuning for real AI adapters (ignored by the mock provider)
- `DATABASE_URL` — libSQL URL for the SQLite database, e.g.
  `file:./local-data/cards.sqlite`
- `AUTH_PROVIDER` — `dev` (default) or `cognito`
- `DEV_USER_ID` / `DEV_USER_EMAIL` / `DEV_USER_NAME` — identity used by the
  `dev` auth provider

## Project structure

```text
src/
  app/              Next.js App Router (UI + route handlers)
  lib/env/          Validated environment configuration
  lib/api/          API envelope + auth wrapper for route handlers
  server/ai/        Vendor-neutral AIProvider interface + adapters (mock first)
  server/auth/      Vendor-neutral AuthProvider interface + adapters (dev first)
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
