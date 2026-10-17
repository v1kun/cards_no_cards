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

## Configuration

All configuration is validated at startup by `src/lib/env`. Missing or invalid
variables fail fast with a clear error. Copy `.env.example` and fill values in
`.env.local`. Key variables:

- `AI_PROVIDER` — `mock` (default) or `openai`
- `OPENAI_API_KEY` — required only when `AI_PROVIDER=openai`
- `DATABASE_URL` — local SQLite path (used from a later phase)

## Project structure

```text
src/
  app/          Next.js App Router (UI + route handlers)
  lib/env/      Validated environment configuration
  server/ai/    Vendor-neutral AIProvider interface + adapters (mock first)
  domain/       Pure domain logic (scheduling, exercises) — added per phase
tests/
  unit/         Unit tests
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
