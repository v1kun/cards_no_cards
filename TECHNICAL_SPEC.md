# TECHNICAL_SPEC.md

## Technical specification: Spanish vocabulary retention PWA

**Version:** 0.1\
**Status:** Draft for implementation planning\
**Product scope:** Personal vocabulary-retention app, initially Spanish
only\
**Primary client:** Installable PWA optimized for iPhone\
**Authentication:** Sign in with Apple via Amazon Cognito User Pools\
**AI design:** Provider-agnostic server-side adapter

------------------------------------------------------------------------

## 1. Goals and non-goals

### Goals

1.  Let the user import free-form lesson notes and vocabulary in one
    text field.
2.  Convert imported text into structured Spanish vocabulary records
    with translations, lemmas, parts of speech, topics, and examples.
3.  Keep a durable vocabulary library and review history synchronized
    across devices.
4.  Run short adaptive sessions, targeting about three minutes and
    introducing around five new words per session.
5.  Adjust future reviews based on independent recall, hints, and
    errors.
6.  Allow AI providers to be replaced without changing domain logic.
7.  Protect all user-owned data with server-side authorization and
    server-side ownership checks.

### Non-goals for the first release

-   Direct integration with ProgressMe.
-   Native iOS application.
-   Deep native Siri/App Intents integration.
-   OCR from images or screenshots.
-   Offline-first editing with complex conflict resolution.
-   Social features, payments, public subscriptions, or multi-language
    learning UI.
-   Training a custom language model.

Voice capture through Apple Shortcuts may be added after the core text
workflow is stable.

------------------------------------------------------------------------

## 2. Proposed stack

Use a single repository and a modular monolith.

-   **Web app:** Next.js App Router, React, TypeScript.
-   **PWA:** Web app manifest, icons, install guidance, service worker
    only for safe static assets and app shell. Do not cache private API
    responses or sensitive user data by default.
-   **Database:** SQLite.
-   **Authentication:** Amazon Cognito User Pools with Apple OAuth provider.
-   **Server API:** Next.js Route Handlers for application-specific
    operations.
-   **Validation:** Zod (or an equivalent schema validator) at every
    external boundary.
-   **AI integration:** Internal `AIProvider` interface implemented by
    one provider adapter initially.
-   **Testing:** Unit tests for domain logic; integration tests for
    repositories and API routes; database policy tests for access
    isolation; end-to-end tests for critical user journeys.
-   **Deployment:** One supported Next.js hosting environment plus
    Amazon Cognito. Keep environment-specific configuration outside source
    control.

Pin dependency versions and follow the current official documentation
when scaffolding. Avoid introducing a queue, microservices, or a
separate backend service until measured requirements justify them.

### Architecture diagram

``` text
iPhone PWA / Browser
        |
        | HTTPS + authenticated session
        v
Next.js UI + Route Handlers
        |
        +---- Auth/session validation
        |
        +---- Domain services
        |       +---- Vocabulary service
        |       +---- Import parsing service
        |       +---- Review scheduler
        |       +---- Exercise selection/evaluation
        |
        +---- Repository layer
        |       |
        |       v
        |    SQLite (server-side ownership checks)
        |
        +---- AI provider interface
                |
                +---- Provider adapter A (initial)
                +---- Provider adapter B (future)
```

### Architectural rule

The AI model may propose linguistic content, but it must not be the
source of truth for user data, permissions, review state, or scheduling.
These are validated and controlled by application code.

------------------------------------------------------------------------

## 3. Repository structure

Use a structure similar to the following. The coding assistant may
adjust filenames to current framework conventions, but it must preserve
the module boundaries.

``` text
src/
  app/
    (auth)/
      sign-in/
    (app)/
      page.tsx
      import/
      practice/
      vocabulary/
      settings/
    api/
      v1/
        imports/route.ts
        imports/[id]/route.ts
        imports/[id]/confirm/route.ts
        vocabulary/route.ts
        vocabulary/[id]/route.ts
        review/session/route.ts
        review/attempts/route.ts
        topics/route.ts
        account/route.ts
  components/
    ui/
    app/
    vocabulary/
    practice/
  features/
    auth/
    imports/
    vocabulary/
    topics/
    practice/
  server/
    auth/
    db/
    repositories/
    services/
    ai/
      types.ts
      provider-factory.ts
      adapters/
    validation/
  domain/
    vocabulary/
    review/
    exercises/
  lib/
    Amazon Cognito/
    env/
  types/
Amazon Cognito/
  migrations/
  tests/
tests/
  unit/
  integration/
  e2e/
docs/
  PRODUCT_SPEC.md
  TECHNICAL_SPEC.md
  IMPLEMENTATION_PLAN.md
```

Rules: - Components must not call the AI provider directly. - Domain
logic must not import a vendor-specific AI SDK. - Database access should
go through typed repositories or a clearly defined data-access layer. -
Every database schema change must be a migration. - Do not commit `.env`
files, credentials, private keys, or user data.

------------------------------------------------------------------------

## 4. Domain model

Use UUID primary keys. Store timestamps as `timestamptz` in UTC. The UI
formats times for the user's locale.

### 4.1 Tables

#### `profiles`

-   `id uuid primary key references auth.users(id) on delete cascade`
-   `created_at timestamptz not null default now()`
-   `updated_at timestamptz not null default now()`
-   `preferred_locale text not null default 'en'` (UI locale only; may
    be changed later)
-   `timezone text` (optional; validate as an IANA timezone)
-   `onboarding_completed_at timestamptz null`

Do not duplicate Apple's identity tokens or credentials in this table.

#### `lessons`

-   `id uuid primary key`
-   `user_id uuid not null references auth.users(id) on delete cascade`
-   `title text null`
-   `lesson_date date null`
-   `source_type text not null check in ('tutor_lesson','homework','manual','voice','other')`
-   `source_note text null`
-   `created_at timestamptz not null default now()`

A lesson is an optional grouping for words from the same session or
assignment.

#### `vocabulary_items`

-   `id uuid primary key`
-   `user_id uuid not null references auth.users(id) on delete cascade`
-   `lemma text not null`
-   `translation text not null`
-   `part_of_speech text not null`
-   `definition text null`
-   `gender text null` (for nouns where applicable: `masculine`,
    `feminine`, `common`, `unknown`)
-   `example_sentence text null`
-   `example_translation text null`
-   `language_code text not null default 'es'`
-   `status text not null default 'active' check in ('active','archived')`
-   `ai_confidence numeric null`
-   `created_at timestamptz not null default now()`
-   `updated_at timestamptz not null default now()`

`part_of_speech` should use a controlled set, for example: `noun`,
`verb`, `adjective`, `adverb`, `preposition`, `pronoun`, `conjunction`,
`expression`, `other`. Store display labels separately from internal
values.

Create indexes on `(user_id, lemma)` and `(user_id, status)`. Do not
assume lemma alone uniquely identifies a lexical item; homonyms and
different senses may require separate records.

#### `vocabulary_forms`

-   `id uuid primary key`
-   `user_id uuid not null references auth.users(id) on delete cascade`
-   `vocabulary_item_id uuid not null references vocabulary_items(id) on delete cascade`
-   `form text not null`
-   `form_type text null` (e.g. `present_1s`, `preterite_1s`,
    `participle`, `plural`, `feminine`)
-   `grammar_note text null`
-   `created_at timestamptz not null default now()`

Forms belong to a lexical item, but an inflected form must not
automatically become a separate vocabulary item. Validate ownership
consistency in the repository and server-side ownership checks.

#### `topics`

-   `id uuid primary key`
-   `user_id uuid not null references auth.users(id) on delete cascade`
-   `name text not null`
-   `normalized_name text not null`
-   `created_at timestamptz not null default now()`

Create a unique constraint on `(user_id, normalized_name)`.

#### `vocabulary_topics`

-   `user_id uuid not null references auth.users(id) on delete cascade`
-   `vocabulary_item_id uuid not null references vocabulary_items(id) on delete cascade`
-   `topic_id uuid not null references topics(id) on delete cascade`
-   Primary key `(vocabulary_item_id, topic_id)`

A word may belong to multiple topics. Topic and part of speech are
separate dimensions.

#### `word_sources`

-   `id uuid primary key`
-   `user_id uuid not null references auth.users(id) on delete cascade`
-   `vocabulary_item_id uuid not null references vocabulary_items(id) on delete cascade`
-   `lesson_id uuid null references lessons(id) on delete set null`
-   `source_type text not null check in ('tutor_lesson','homework','manual','voice','ai_suggested','other')`
-   `source_text text null`
-   `created_at timestamptz not null default now()`

This table allows a word to be encountered in multiple lessons or
sources.

#### `import_batches`

-   `id uuid primary key`
-   `user_id uuid not null references auth.users(id) on delete cascade`
-   `lesson_id uuid null references lessons(id) on delete set null`
-   `raw_text text not null`
-   `status text not null check in ('pending','processing','needs_review','confirmed','failed')`
-   `parsed_payload jsonb null`
-   `error_code text null`
-   `created_at timestamptz not null default now()`
-   `updated_at timestamptz not null default now()`

Keep raw imports only as long as needed for editing and product
usefulness. Provide a deletion path. Do not store secrets in imported
text.

#### `import_items`

-   `id uuid primary key`
-   `user_id uuid not null references auth.users(id) on delete cascade`
-   `import_batch_id uuid not null references import_batches(id) on delete cascade`
-   `proposed_lemma text null`
-   `proposed_translation text null`
-   `proposed_part_of_speech text null`
-   `proposed_topics jsonb not null default '[]'`
-   `proposed_forms jsonb not null default '[]'`
-   `proposed_example text null`
-   `proposed_example_translation text null`
-   `confidence numeric null`
-   `match_vocabulary_item_id uuid null references vocabulary_items(id) on delete set null`
-   `decision text not null default 'pending' check in ('pending','create','merge','skip')`
-   `created_vocabulary_item_id uuid null references vocabulary_items(id) on delete set null`
-   `created_at timestamptz not null default now()`

The AI proposal is not saved as canonical vocabulary until the user
confirms it or a clearly defined safe auto-confirm rule is added later.

#### `review_states`

-   `id uuid primary key`
-   `user_id uuid not null references auth.users(id) on delete cascade`
-   `vocabulary_item_id uuid not null unique references vocabulary_items(id) on delete cascade`
-   `due_at timestamptz null`
-   `introduced_at timestamptz null`
-   `successful_recalls integer not null default 0`
-   `consecutive_failures integer not null default 0`
-   `review_stage integer not null default 0`
-   `difficulty numeric not null default 0.5`
-   `last_result text null check in ('recalled','recalled_with_hint','wrong','skipped')`
-   `last_reviewed_at timestamptz null`
-   `updated_at timestamptz not null default now()`

Create an index on `(user_id, due_at)`.

#### `review_attempts`

-   `id uuid primary key`
-   `user_id uuid not null references auth.users(id) on delete cascade`
-   `vocabulary_item_id uuid not null references vocabulary_items(id) on delete cascade`
-   `session_id uuid null`
-   `exercise_type text not null`
-   `prompt_snapshot jsonb not null`
-   `submitted_answer text null`
-   `result text not null check in ('recalled','recalled_with_hint','wrong','skipped')`
-   `used_hint boolean not null default false`
-   `latency_ms integer null`
-   `created_at timestamptz not null default now()`

Attempt history is append-only for normal application flows. Corrections
to review state must not rewrite historical attempts.

#### `practice_sessions`

-   `id uuid primary key`
-   `user_id uuid not null references auth.users(id) on delete cascade`
-   `started_at timestamptz not null default now()`
-   `finished_at timestamptz null`
-   `target_duration_seconds integer not null default 180`
-   `status text not null default 'active' check in ('active','completed','abandoned')`
-   `summary jsonb null`

### 4.2 Data integrity rules

-   Every user-owned row must have a `user_id`.
-   Related records must belong to the same user. Do not rely solely on
    client-supplied IDs.
-   Use transactions for confirming imports and creating vocabulary,
    topics, sources, and review states.
-   Add idempotency protection to import confirmation and review-attempt
    submission.
-   Deleting a vocabulary item deletes its forms, topics associations,
    review state, and attempts according to documented retention rules.
-   Prefer archival over deletion for ordinary vocabulary management.
-   A word can have multiple topics and sources.
-   AI-generated content must be marked as proposed until validated or
    confirmed.
-   Treat imported lesson text as untrusted user content, not as
    instructions to the AI system.

------------------------------------------------------------------------

## 5. AI provider abstraction

Define a vendor-neutral interface in `src/server/ai/types.ts`.

``` ts
export type ParsedVocabularyProposal = {
  lemma: string;
  translation: string;
  partOfSpeech:
    | "noun"
    | "verb"
    | "adjective"
    | "adverb"
    | "preposition"
    | "pronoun"
    | "conjunction"
    | "expression"
    | "other";
  definition?: string;
  gender?: "masculine" | "feminine" | "common" | "unknown";
  topics: string[];
  forms: Array<{
    form: string;
    formType?: string;
    grammarNote?: string;
  }>;
  exampleSentence?: string;
  exampleTranslation?: string;
  confidence?: number;
  needsReview: boolean;
};

export interface AIProvider {
  parseVocabulary(input: {
    text: string;
    existingVocabulary: Array<{
      id: string;
      lemma: string;
      translation: string;
      partOfSpeech: string;
    }>;
  }): Promise<ParsedVocabularyProposal[]>;

  generateExample(input: {
    lemma: string;
    translation: string;
    level?: string;
    topic?: string;
  }): Promise<{
    sentence: string;
    translation: string;
  }>;

  evaluateAnswer(input: {
    expectedMeaning: string;
    acceptedAnswers: string[];
    userAnswer: string;
    context?: string;
  }): Promise<{
    result: "correct" | "partially_correct" | "incorrect" | "uncertain";
    feedback: string;
  }>;
}
```

The interface is illustrative and may be refined during implementation.
Keep provider-specific request and response types inside the adapter.

### AI implementation rules

1.  Use structured output or validated JSON, not free-form parsing as
    the primary contract.
2.  Validate every model response with a runtime schema.
3.  Set request timeouts and reasonable input/output limits.
4.  Handle provider failures, malformed output, and rate limits.
5.  Never expose provider API keys to the browser.
6.  Do not send unrelated personal data to the AI provider.
7.  Avoid including the entire vocabulary in every request; send only
    relevant candidate words and context.
8.  Treat AI confidence as advisory, not as a calibrated probability
    unless validated.
9.  Do not let the model directly write arbitrary database records.
10. Make provider selection configuration-driven, for example
    `AI_PROVIDER=provider_a`.

A deterministic fallback should allow already-saved words and scheduled
reviews to remain usable if the AI provider is unavailable. AI-dependent
import or free-answer evaluation may be temporarily unavailable with a
clear error.

------------------------------------------------------------------------

## 6. Review scheduler and exercise selection

Keep scheduling deterministic and testable in `src/domain/review/`. Do
not ask the AI model to choose review dates.

### Initial behavior

-   New words enter a learning queue.
-   A session targets approximately five new words, subject to
    availability and the number of due reviews.
-   Session target duration is 180 seconds, but there is no forced
    countdown.
-   Due words take priority over introducing too many new words.
-   A correct answer without a hint counts as independent recall.
-   A correct answer after a hint is recorded separately and should
    increase the interval less aggressively.
-   An incorrect answer increments the failure count and schedules an
    earlier review.
-   A skipped answer is recorded distinctly and should not count as a
    failure or success.
-   A single correct answer never marks a word as permanently mastered.

Possible initial intervals: 1, 3, 7, 14, and 30 days. Store the
scheduling parameters in one module and cover them with tests; do not
scatter constants throughout UI code.

### Exercise selection

The exercise selector should consider: - whether the word is new or
due; - prior independent recalls; - prior hints and errors; - known
difficulty type, where available; - whether the learner has already seen
the same prompt recently.

Possible exercise types: - multiple choice; - recall from translation; -
cloze / missing word; - short phrase translation; - contextual
production.

Start with a small reliable subset. Do not generate a completely new
exercise for every attempt if a simpler validated prompt is available.

### Answer evaluation

Use deterministic checks for simple objective exercises when possible.
Use the AI adapter for open-ended answers, synonyms, or contextual
language responses.

If AI returns `uncertain`, do not automatically mark the answer wrong.
Ask the user to retry, present a conservative explanation, or record the
result as uncertain according to a documented policy.

------------------------------------------------------------------------

## 7. API contract

Use versioned application routes under `/api/v1`. All endpoints except
the authentication callback and explicitly public health/config routes
require an authenticated session.

Use consistent JSON responses:

``` json
{
  "data": {},
  "error": null,
  "requestId": "opaque-request-id"
}
```

On failure:

``` json
{
  "data": null,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The request could not be validated."
  },
  "requestId": "opaque-request-id"
}
```

Do not expose stack traces, SQL messages, provider responses, or secrets
to clients.

### Authentication

-   Use Amazon Cognito User Pools with the Apple provider.
-   Protect application routes and refresh sessions using the
    recommended current Amazon Cognito SSR integration.
-   Keep callback URLs restricted to configured domains.
-   Do not implement a custom password or token system.
-   Provide a sign-out action.
-   Account deletion must delete or anonymize owned application data
    according to the documented retention policy.

### Endpoints

#### `POST /api/v1/imports`

Create an import batch and request AI parsing.

Request:

``` json
{
  "rawText": "olvidar — забывать; comprar — покупать",
  "lessonId": null,
  "sourceType": "tutor_lesson"
}
```

Response:

``` json
{
  "data": {
    "importBatchId": "uuid",
    "status": "needs_review",
    "items": []
  },
  "error": null,
  "requestId": "..."
}
```

Validate maximum text length, content type, authentication, and rate
limits. Persist the batch before or as part of processing so failures
can be retried safely.

#### `GET /api/v1/imports/:id`

Return the current batch status and proposed items. Verify ownership.

#### `PATCH /api/v1/imports/:id`

Allow editing proposals or decisions before confirmation. Validate every
field.

#### `POST /api/v1/imports/:id/confirm`

Confirm selected proposals, merge with existing words, create topic
links and review states transactionally. Must be idempotent.

#### `GET /api/v1/vocabulary`

Return paginated vocabulary. Support filters: - `topicId` -
`partOfSpeech` - `status` - `dueOnly` - `search`

Use bounded page sizes and stable ordering.

#### `POST /api/v1/vocabulary`

Create a manually entered word. Validate required fields and ownership
of referenced topics.

#### `GET /api/v1/vocabulary/:id`

Return a word, forms, topics, sources, and review summary.

#### `PATCH /api/v1/vocabulary/:id`

Update editable fields. Do not allow a client to set arbitrary review
state through this endpoint.

#### `DELETE /api/v1/vocabulary/:id`

Prefer an archive operation for normal user flows. Permanent deletion
must follow explicit rules and remove dependent data safely.

#### `GET /api/v1/topics`

List the current user's topics.

#### `POST /api/v1/topics`

Create a topic, normalizing whitespace and case for duplicate detection.

#### `POST /api/v1/review/session`

Create or resume a session. Select due words and a bounded number of new
words. Return the next exercise prompt without revealing its expected
answer in client-visible data.

#### `POST /api/v1/review/attempts`

Submit an answer. Validate the session and word association, evaluate
the response, append a review attempt, update review state, and return
feedback plus the next action.

Use an idempotency key or unique client-generated attempt ID to prevent
duplicate submissions after retries.

#### `POST /api/v1/review/session/:id/finish`

Finish the session and return a summary derived from stored attempts.

#### `GET /api/v1/account`

Return minimal account settings and sync status.

#### `DELETE /api/v1/account`

Require explicit confirmation and a valid authenticated session. Delete
user-owned records and account data in a controlled sequence. Document
any third-party identity-provider cleanup requirements separately.

### API conventions

-   Validate path parameters, query parameters, and bodies.
-   Return appropriate HTTP status codes.
-   Use pagination for growing lists.
-   Add rate limits to AI-consuming endpoints.
-   Avoid logging raw lesson content unless explicitly needed for
    debugging and approved by the user.
-   Do not return correct answers in the initial exercise payload where
    that would undermine the exercise.

------------------------------------------------------------------------

## 8. Security and privacy

### Authentication and authorization

-   Use Amazon Cognito User Pools for Sign in with Apple.
-   Configure the Apple Services ID, allowed domain, and redirect URI in
    the Apple Developer portal and Amazon Cognito dashboard.
-   Do not assume local development callback URLs will be accepted by
    Apple; use a valid configured domain or a documented development
    setup.
-   Verify the session server-side for protected routes.
-   Enforce ownership checks in server-side repositories and database
    policies.

### Row Level Security

Enable Row Level Security on every user-owned table exposed through
Amazon Cognito APIs. Add explicit policies for `select`, `insert`, `update`,
and `delete` as appropriate. For inserts and updates, ensure `user_id`
matches the authenticated user. Verify foreign-key relationships do not
allow linking to another user's records.

Do not expose the Amazon Cognito service-role or secret key to client code.
Use the publishable key in the browser only with correctly configured
server-side ownership checks and least-privilege grants.

### Secrets

Keep these in server-side environment variables or the deployment secret
store: - AI provider API key; - Amazon Cognito service-role key, if needed for
tightly controlled server operations; - Apple client secret/private-key
material, if handled by the application rather than Amazon Cognito User Pools.

Never commit secrets. Provide `.env.example` with placeholder values
only.

### Input and output validation

-   Validate all user input on the server.
-   Treat lesson text and model output as untrusted.
-   Render imported text as text, not raw HTML.
-   Validate AI responses before use.
-   Limit payload sizes and AI token budgets.
-   Use timeouts and safe error handling.
-   Avoid putting sensitive content in analytics or logs.

### Data lifecycle

-   Define deletion behavior for imports, words, sessions, attempts, and
    accounts.
-   Prefer minimal data collection.
-   Do not store Apple access or identity tokens as application profile
    data.
-   Make backups and restoration procedures part of deployment
    operations before relying on the app for long-term learning history.

------------------------------------------------------------------------

## 9. PWA requirements

-   Include a valid web app manifest with app name, icons, start URL,
    and display mode.
-   Provide install guidance for iPhone Safari.
-   Ensure primary interactions work with touch and mobile viewport
    sizes.
-   Use accessible labels, focus states, and sufficient contrast.
-   Avoid relying on hover-only interactions.
-   Cache static assets cautiously.
-   Do not cache authenticated API responses or private vocabulary by
    default in the service worker.
-   Show a clear network or synchronization error when the server is
    unavailable.
-   Test the actual install and sign-in flows on an iPhone, not only in
    desktop emulation.

PWA installation does not provide the full native iOS capability set.
Siri Shortcuts integration is a separate planned feature.

------------------------------------------------------------------------

## 10. Testing strategy

### Unit tests

Required for: - lemma normalization helpers; - duplicate-candidate
matching; - topic normalization; - review interval updates; - exercise
selection; - hint-vs-independent-recall scoring; - API input schemas; -
AI response schema validation.

### Integration tests

Required for: - import batch lifecycle; - transactional confirmation; -
repository ownership checks; - review attempt persistence; -
retry/idempotency behavior; - AI provider failure handling.

### Database security tests

Verify that: - an unauthenticated user cannot access private rows; -
user A cannot read or modify user B's data; - a user cannot attach
another user's topic or lesson to a word; - insert/update/delete
policies enforce ownership; - service-role credentials are never used in
browser bundles.

### End-to-end tests

Critical journeys: 1. Sign in with Apple in a configured test
environment. 2. Import a short vocabulary list. 3. Review and confirm
proposed words. 4. Start a practice session. 5. Submit correct, hinted,
incorrect, and skipped answers. 6. Reload and verify persistence. 7.
Open the same account on a second browser/device session and verify
synchronization. 8. Sign out and verify private screens are
inaccessible.

Mock AI responses for most automated tests. Keep a small optional smoke
test for the live provider so the main suite is reliable and
inexpensive.

------------------------------------------------------------------------

## 11. Implementation phases and acceptance criteria

### Phase 0 --- Project foundation

Tasks: - Create repository and Next.js TypeScript app. - Configure
linting, formatting, type checking, tests, and environment validation. -
Add basic CI commands. - Create `.env.example`. - Add a README with
local setup instructions.

Acceptance: - A clean checkout can be installed and run using the
documented steps. - Lint, typecheck, and baseline tests pass. - No
secret values are committed.

### Phase 1 --- Database and security foundation

Tasks: - Create Amazon Cognito project and migrations. - Implement core tables
and indexes. - Configure Apple provider and Amazon Cognito User Pools. - Add server-side ownership checks
policies and database security tests. - Implement typed repository
layer.

Acceptance: - Authentication works in a configured environment. -
Cross-user access tests pass. - Schema can be recreated from migrations.

### Phase 2 --- Vocabulary CRUD

Tasks: - Implement vocabulary and topic APIs. - Build the dictionary
screen and basic filters. - Add edit and archive flows. - Add forms and
sources.

Acceptance: - Words can be created, edited, listed, filtered, and
archived. - Topics and parts of speech work independently. - Data
persists across sessions.

### Phase 3 --- AI import pipeline

Tasks: - Define `AIProvider` interface. - Implement the first provider
adapter. - Parse free-form Spanish vocabulary lists. - Add proposal
review UI, duplicate matching, and transactional confirmation. - Add
failure and retry behavior.

Acceptance: - A sample list becomes editable structured proposals. -
Invalid model output is rejected safely. - Confirming an import does not
create duplicates when retried. - Provider failure does not corrupt
existing vocabulary.

### Phase 4 --- Practice and scheduling

Tasks: - Implement practice sessions and review state. - Add a
deterministic scheduler. - Implement the initial exercise types. -
Record attempts and hint usage. - Build feedback and session summary
screens.

Acceptance: - The user can complete a short session. - Attempt history
persists. - Hints and errors influence future scheduling differently. -
A single correct answer does not mark a word as permanently mastered.

### Phase 5 --- PWA and cross-device validation

Tasks: - Add manifest, icons, and install guidance. - Review
service-worker caching behavior. - Test mobile layout and touch
interactions. - Verify session handling and sync across devices.

Acceptance: - The app can be installed on iPhone. - No private API
response is accidentally cached. - Vocabulary and review history
synchronize after signing into the same account on another device.

### Phase 6 --- Polish and release readiness

Tasks: - Improve loading, empty, offline, and error states. - Add
account deletion flow. - Review privacy, logging, backups, and
recovery. - Run all automated tests and manual iPhone acceptance
tests. - Document deployment and rollback steps.

Acceptance: - All critical journeys pass. - Known limitations are
documented. - Deployment and recovery instructions are usable by someone
other than the original developer.

### Later phase --- Voice capture

Use Apple Shortcuts to capture dictated text and submit it to an
authenticated, protected endpoint. Do not create a public
unauthenticated import endpoint. Decide the shortcut authentication flow
and token handling before implementation. Native Siri/App Intents work
remains outside the MVP.

------------------------------------------------------------------------

## 12. Working rules for the AI coding assistant

The coding assistant must follow these rules throughout implementation:

1.  Read `PRODUCT_SPEC.md`, `TECHNICAL_SPEC.md`, and the current
    implementation plan before making changes.
2.  Work on one bounded phase or task at a time.
3.  Before coding, state the files and behavior it intends to change.
4.  Do not silently change the agreed architecture or data model.
    Explain proposed changes first.
5.  Create migrations for database changes; do not rely on undocumented
    manual dashboard edits.
6.  Add tests alongside new domain behavior.
7.  Run lint, typecheck, unit tests, and relevant integration tests
    after changes.
8.  Do not claim tests passed unless they were actually run.
9.  Never insert fake production credentials or expose secrets in client
    code.
10. Do not disable security checks to make a test pass.
11. Update documentation and the implementation checklist at the end of
    each task.
12. If a required external credential or dashboard configuration is
    unavailable, implement the code path where possible, document the
    missing setup, and do not pretend the integration is verified.
13. Prefer the simplest implementation that satisfies this
    specification.
14. Keep the app usable when the AI provider is temporarily unavailable,
    at least for viewing saved words and running exercises that do not
    require live AI.
15. When requirements are ambiguous, list the ambiguity and propose a
    conservative default rather than inventing a major feature.

------------------------------------------------------------------------

## 13. Open decisions

The following decisions can remain open until the relevant
implementation phase: - Exact AI provider and model. - Hosting provider
and production domain. - Exact review scheduling formula after initial
usability testing. - Whether imports should be retained indefinitely or
automatically cleaned up. - Whether the app needs a second UI
language. - The precise Apple Shortcuts authentication flow. - Backup
retention and recovery-point objectives.

Do not block the initial project skeleton on decisions that are not yet
needed.

------------------------------------------------------------------------

## 14. Definition of technical completion

The technical MVP is complete when: - the app is deployable from
documented source; - Sign in with Apple works in the configured
environment; - database migrations reproduce the schema; - server-side ownership checks tests
demonstrate user isolation; - vocabulary import and confirmation work
end to end; - practice attempts update persistent review state; - the AI
adapter can be replaced without rewriting domain services; - PWA
installation and cross-device sync are verified; - all critical
automated tests pass; - remaining limitations and operational steps are
documented.


---

## 15. Deployment model: local development and one personal AWS environment

### Cost principle

Keep recurring cloud costs as low as practical. Do not create separate always-on AWS development and production environments for the MVP. Local development is the default; AWS hosts the personal, remotely accessible instance.

### Environments

#### Local
- Next.js application runs locally.
- SQLite runs locally through Docker Compose.
- Schema changes are managed only through versioned migrations.
- Automated tests use a local/test database and mock AI provider by default.
- Real AI API calls are opt-in for manual testing.
- Apple sign-in can use a documented local development callback strategy; production Apple sign-in must be tested against the configured public domain.
- Local environment must not depend on AWS being available.

#### Personal cloud
- One EC2 instance runs Docker Compose or an equivalent simple container setup.
- The same application container image is used after CI verification.
- SQLite runs on the same EC2 instance for the initial MVP, bound to localhost/private container networking only.
- HTTPS is provided by Caddy or an equivalent reverse proxy.
- Only required inbound ports are exposed: HTTPS (443) and, if needed for HTTP-to-HTTPS redirect or certificate issuance, HTTP (80). SSH should not be open to the whole internet; prefer AWS Systems Manager where supported.
- Backups are stored outside the instance, such as in a private S3 bucket.
- No RDS, NAT Gateway, ECS, Application Load Balancer, or always-on cloud development environment in the initial MVP unless a documented need and cost estimate justify it.

### Container and configuration requirements

- Provide `Dockerfile` and `compose.yaml` for local development.
- Keep production configuration separate from local configuration.
- Use `.env.example` with placeholder values only; never commit real `.env` files.
- Persist local SQLite data in a Docker volume.
- Persist cloud SQLite data on a dedicated persistent EBS volume or an explicitly documented persistent volume configuration.
- Do not store the only copy of the database on the container writable layer.
- Add health checks and a documented recovery procedure.
- Pin container image versions and dependencies where practical.
- Ensure the chosen EC2 architecture (for example ARM64) is supported by the application image and all dependencies before selecting the instance type.

### Deployment workflow

1. Developer works locally and runs checks.
2. Pull request or push triggers GitHub Actions: lint, typecheck, unit tests, integration tests where configured, and production build.
3. Merge to `main` triggers deployment workflow for the personal cloud environment, subject to required environment protection settings.
4. Workflow obtains temporary AWS credentials through GitHub OIDC; do not store permanent AWS access keys in GitHub.
5. Workflow publishes or transfers the verified image/artifact and initiates deployment on EC2 through AWS Systems Manager where feasible.
6. Deployment runs database migrations as a controlled step, checks application health, and reports success/failure.
7. On failure, retain the previous known-good image and document rollback steps.

For a single personal server, a simple deploy mechanism is acceptable. Avoid building a complex release platform. If the deployment requires SSH as a temporary fallback, use a narrowly scoped key and restricted network access, document it as a deviation, and do not expose SSH broadly.

### Terraform requirements

- Terraform code lives in `infra/terraform/`.
- A bootstrap step creates the remote Terraform state bucket and required locking mechanism appropriate to the chosen Terraform version. Document any one-time bootstrap steps.
- State bucket access must be private and least-privilege; enable encryption and versioning.
- Use GitHub OIDC and an IAM role for Terraform plan/apply and deployment tasks.
- Separate Terraform plan from apply. Production/personal-cloud changes should require an explicit protected workflow or approval until the user chooses otherwise.
- Avoid hard-coded account IDs, region-specific assumptions, and secrets in source files.
- Prefer small, understandable Terraform modules over premature abstraction.
- Terraform must create only the resources required for the selected low-cost design.
- Add AWS Budget alerts and document that alerts are not a hard spending cap.
- Document the expected recurring cost and any resources that continue billing when the EC2 instance is stopped.

### Backup and recovery requirements

- Back up SQLite to a private S3 bucket on a schedule.
- Apply lifecycle/retention rules to avoid unlimited backup growth.
- Do not store backups only on the same EC2 instance.
- Document and test restoring a backup into a separate local or temporary database.
- Backups must not be publicly accessible.
- Before applying destructive migrations, create or verify a recent backup.

### Explicit trade-offs

The single-instance design is appropriate for a personal MVP but has a single point of failure. The application and database may both be unavailable during host failure or maintenance. Recovery depends on the last valid external backup. This is an accepted MVP trade-off, not high availability.

### Acceptance criteria for this deployment model

- A new developer checkout can start the app and local database using documented commands.
- Local tests do not require AWS credentials.
- Local tests use a mock AI provider by default.
- Database schema can be recreated entirely from migrations.
- The personal AWS environment can be created from Terraform and documented bootstrap steps.
- GitHub Actions can deploy without permanent AWS access keys.
- The database port is not publicly reachable.
- HTTPS works on the configured public domain.
- A backup can be restored using documented steps.
- The estimated AWS cost and major cost drivers are documented.


## Current implementation decisions (supersede earlier conflicting draft sections)

These decisions are authoritative for the MVP. If older sections below conflict with this section, follow this section.

- **Authentication now:** email/username + password using Amazon Cognito User Pools. Do not build custom password storage or password hashing.
- **Sign in with Apple:** deferred to a later technical-debt milestone. Prefer adding Apple as another Cognito identity provider later rather than replacing the auth architecture.
- **AI provider now:** OpenAI API, behind the provider-neutral `AIProvider` interface. “ChatGPT” in product conversation means the OpenAI API, not use of a ChatGPT consumer subscription as API access. API billing is separate.
- **Cloud hosting:** one AWS EC2 instance initially, starting with `t4g.nano` as an explicitly experimental minimum-cost target. Upgrade to `t4g.small` or larger if memory pressure, restarts, latency, or database performance make the app unreliable.
- **Environments:** local development plus one personal cloud environment. Do not provision a separate always-on AWS dev environment.
- **Domain and HTTPS:** deferred until cloud access from iPhone and real OAuth/cookie behavior need public deployment. Before exposing the app over the public internet, HTTPS is mandatory. Do not collect credentials over plain HTTP.
- **IaC and CI/CD:** Terraform, GitHub repository, GitHub Actions, and GitHub OIDC for short-lived AWS credentials. No long-lived AWS access keys in GitHub.

### Cognito authentication requirements

- Use Cognito User Pools for sign-up/sign-in and password recovery.
- Prefer email as the sign-in identifier for the MVP unless the UI specification explicitly requires a separate username.
- Never store passwords in the application database.
- Validate Cognito-issued tokens server-side for protected API requests.
- Keep Cognito app-client configuration appropriate for a public web client; do not embed a client secret in browser code.
- Use secure, HttpOnly, SameSite cookies or the current framework's recommended secure session approach; document CSRF protections where cookie-based mutations are used.
- Configure redirect URLs narrowly and avoid wildcard production callbacks.
- Add Apple federation later as a separate milestone; do not implement Apple now.
- Local authentication development must use a documented local callback setup and must not weaken production callback restrictions.

### OpenAI API requirements

- Implement OpenAI only inside an adapter implementing `AIProvider`.
- Keep the API key server-side only, in local environment configuration for development and AWS Secrets Manager or an equally protected server-side secret source in the cloud.
- The consumer ChatGPT subscription is not an API credential or automatic API credit.
- Add per-request input/output limits, timeouts, bounded retries, and clear provider error handling.
- Mock the AI adapter in automated tests by default to avoid unnecessary API cost.
- Do not send passwords, authentication tokens, or unrelated personal data to the model.
- Provider replacement must not require changes to vocabulary, scheduling, or review domain logic.

### EC2 `t4g.nano` constraint

- `t4g.nano` is an experimental cost-minimum starting point, not a guaranteed suitable production size.
- Build the production image in GitHub Actions; do not compile Next.js on the nano instance.
- Start with resource limits and lightweight containers; avoid memory-heavy optional services.
- Monitor memory, swap, OOM kills, container restarts, CPU credits, and response latency.
- If the app or database is unstable, upgrade to `t4g.small` or a more suitable instance instead of weakening security or removing required backups.
- Before deploying, verify ARM64 support for the container image and all native dependencies.
- Keep SQLite off public interfaces. Store its data on persistent storage and back it up outside the instance.

### Deferred technical debt

- Sign in with Apple.
- Public domain and production HTTPS setup, until cloud deployment is ready; HTTPS is required before public use.
- Apple Shortcuts / Siri voice capture.
- OCR and image import.
- Moving SQLite to RDS or separating app/database services.
- High availability and multi-instance deployment.
- Multi-language support.
