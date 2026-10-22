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

To reach the app from another device on the same network (for example, to
install the PWA on an iPhone), bind the dev server to all interfaces:

```bash
npm run dev:lan
```

Then open `http://<your-computer-ip>:3000` on the phone. The default
`npm run dev` binds to localhost only, so the LAN address is unreachable.

### Running in the background (`service.sh`)

```bash
./service.sh start          # migrate, build if sources changed, start on 0.0.0.0:3000
./service.sh start --dev    # same, but with the hot-reload dev server
./service.sh status | logs | stop | restart
```

The production mode is the one to use on the phone: the service worker (and
offline practice) only runs in production builds. `PORT` and `HOST` override
the defaults; the PID and log live in `.run/`.

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
| `npm run dev:lan`      | Dev server on all interfaces (LAN/iPhone) |
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
| `npm run deck:seed`    | Load the A1 starter deck (see below)      |
| `npm run users:seed`   | Create the local `admin`/`admin1` accounts |

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

- **`local` (default, temporary):** login/password accounts stored in
  `local_accounts` (scrypt hashes) and an HMAC-signed `cnc_session` cookie
  valid for 30 days. Pages without the cookie redirect to `/login`. Create the
  accounts with `npm run users:seed` — it adds **`admin` / `admin`** and
  **`admin1` / `admin1`**, each with its own A1 starter deck. Every user has
  separate words, progress and offline data (one IndexedDB per user; signing
  out deletes it from the device). This is tech debt — see
  `DEFERRED_FEATURES.md`.
- **`dev`:** resolves a stable local session with no real login, so
  the app runs without AWS or Apple (used by tests). Set the `x-dev-user-id` request header to
  act as a different local user — useful for checking that one user cannot see
  another's data.
- **`cognito`:** Amazon Cognito User Pools with Sign in with Apple as a
  federated identity provider. Wired up in the deployment phase.

Protected route handlers are wrapped with `withAuth` (`src/lib/api/respond.ts`),
which rejects unauthenticated requests with `401` and otherwise provides the
resolved session. All responses use the `{ data, error, requestId }` envelope.

Example protected endpoints (with `AUTH_PROVIDER=dev`; under `local` sign in
first: `curl -c jar -H 'content-type: application/json' -d
'{"login":"admin","password":"admin"}' localhost:3000/api/v1/auth/login` and
pass `-b jar`):

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

### Starter deck (Spanish A1)

`data/starter-decks/es-a1/` holds about 1000 common A1 words as TSV files, one
per topic (`# topic: <name>` header, then `lemma · part of speech · gender ·
translation · example · example translation`). Nouns include their article and
every example contains the lemma, so cloze exercises work out of the box.
Translations are Russian.

```bash
npm run deck:seed                 # load es-a1 into the dev user's vocabulary
npm run deck:seed -- <userId>     # load it for another user
```

Words the user already has (case-insensitive lemma match) are skipped, so the
command is safe to re-run. New words get a topic, a `starter_deck` source, and
a fresh review state; press **Generate questions** on the Practice page to
build their exercise bank.

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

## Practice and review

Practice lives at [`/practice`](http://localhost:3000/practice). Pick a
**section** — all words, a category (topic) or a part of speech — and run a
short session. Each session mixes words whose scheduled review is **due** with
up to five **new** words; due reviews are always prioritized. Exercises are
served one at a time: multiple choice for new words, recall from the
translation once a word is known, and cloze (fill-in-the-blank) for well-known
words. Typed answers offer a hint (first letter and length); a hint-assisted
answer is recorded as such.

When a section has nothing due and no new words left, it does not stop: the
session switches to **Extra practice** (badge on each card) with up to 10
already-learned words, weakest first and shuffled, avoiding words drilled a
moment ago. In extra practice only **mistakes** change the schedule (the word
comes back for review soon); correct answers, hints and skips leave it as is.
**Keep practicing** on the summary starts another round.

### Prepared questions (exercise bank)

Questions are **generated ahead of time by AI** and stored per word (a few
variants per exercise type), so practice itself needs no AI calls and no
network. The bank is refreshed **only on demand**: the Practice page shows how
many words have no questions yet and a **Generate questions** button that
processes words in batches of 10. Editing a word marks its questions stale; a
single word can be regenerated from its page. Words without prepared questions
still get a simple built-in multiple-choice question.

### Offline practice and sync

Opening Practice while online saves an **offline snapshot** (words, review
states and prepared questions) in the browser's IndexedDB. From then on
sessions are planned, served and graded on the device, so practice works with
no connection. Answers go to a local outbox and are sent to
`POST /review/sync` in the background — immediately when online, otherwise as
soon as the connection returns. The server re-grades and re-schedules every
attempt itself; the device only predicts the next review locally until the
sync confirms it. Sync is idempotent (client-generated `attemptId`).

Limitation: this is single-user, single-device-at-a-time friendly. If you
practice offline on two devices, both sets of answers are kept, but scheduling
is applied in the order the server receives them (no merge logic beyond that).

Scheduling is deterministic and lives in `src/domain/review/` (the AI model
never chooses review dates). Intervals follow a fixed ladder (1, 3, 7, 14, 30
days):

- An independent correct answer advances a full step.
- A hint-assisted answer counts as a success but grows the interval less
  aggressively, and is recorded separately from independent recall.
- A wrong answer increments the failure count and schedules a much earlier
  review; a single correct answer never permanently "masters" a word.
- A skip is recorded distinctly and counts as neither success nor failure.

Grading is deterministic (accent/case/punctuation lenient) and identical on the
device and the server. Attempt history is append-only.

| Method & path | Purpose |
| --- | --- |
| `GET /offline/snapshot` | Everything needed to practice offline (words, states, prepared questions) |
| `POST /review/sync` | Upload queued attempts/sessions; returns authoritative review states |
| `GET /exercise-bank/status` | How many words have prepared questions, are missing or stale |
| `POST /exercise-bank/refresh` | Generate questions for the next batch of words (optional `exclude`) |
| `POST /vocabulary/:id/exercises/regenerate` | Regenerate one word's questions |

### Settings

[`/settings`](http://localhost:3000/settings) selects the **translation
language** (English or Russian) used for new words, generated questions and
section names. Existing words keep their translations.

## Progressive Web App (install on iPhone)

Cards No Cards is installable to the iPhone home screen and launches
full-screen.

- **Manifest** (`src/app/manifest.ts`, served at `/manifest.webmanifest`):
  standalone display, portrait orientation, dark theme, and app icons.
- **Icons** (`public/icons/`): 192/512 standard plus a maskable 512 (safe-zone
  padded) and a 180px apple-touch icon.
- **Service worker** (`public/sw.js`): registered in production only
  (`src/components/ServiceWorkerRegister.tsx`). It caches same-origin static
  assets (`/_next/static/`, `/icons/`, the manifest) and the HTML shells of the
  offline-capable pages (`/`, `/practice`, `/practice/session`, network-first).
  Those pages are client-rendered and contain no vocabulary. It never caches
  `/api/` responses; offline practice data lives in IndexedDB (see
  [Offline practice and sync](#offline-practice-and-sync)). Other pages show a
  small "You are offline" page when there is no connection.
- **Offline banner** (`src/components/OfflineBanner.tsx`): shown while
  offline; practice keeps working, while editing and imports need the
  connection and surface clear errors so a failed save is never silent.
- **Install steps**: open the site in Safari, tap **Share → Add to Home
  Screen**. The in-app guide lives at `/install`.

## Voice capture (Siri / Apple Shortcuts)

You can add words and ask what to practice by voice, without a native app, by
pairing the iPhone **Shortcuts** app with two JSON endpoints. The in-app guide
with ready-to-build recipes lives at `/shortcuts`.

- **`POST /api/v1/capture`** — body `{ "text": "despedirse - to say goodbye" }`.
  Dictated text is routed through the normal **import pipeline** tagged as a
  `voice` source, so it is parsed and lands in Import as **needs-review** (voice
  never writes confirmed vocabulary directly). Returns a short speakable
  `message` for Siri to read back.
- **`GET /api/v1/capture`** — returns `{ due, new, message }`, a speakable
  summary of what is waiting to be practiced.

Build a Shortcut with **Dictate Text → Get Contents of URL** (POST JSON to the
capture endpoint) **→ Speak Text** (the returned `message`), then trigger it
with *"Hey Siri"*. Because the dev auth provider authenticates every local
request, Shortcuts on the same LAN need no token (run `npm run dev:lan` and use
the Mac LAN address). A production deployment would require the deferred cloud
auth, which Shortcuts cannot easily complete — so voice capture is a
local-network convenience for now.

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
- `AUTH_PROVIDER` — `local` (default), `dev` or `cognito`
- `SESSION_SECRET` — signing secret for `local` session cookies (auto-generated
  into `local-data/session-secret` when unset)
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
  server/services/  Orchestration across repositories, domain, and AI (practice)
  domain/review/    Pure review scheduling + exercise logic (no DB/UI/AI)
  components/       Client components (offline banner, SW registration)
drizzle/            Generated SQL migrations
public/
  sw.js             Service worker (static assets + offline page shells; never caches API)
  icons/            PWA icons (standard, maskable, apple-touch)
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
