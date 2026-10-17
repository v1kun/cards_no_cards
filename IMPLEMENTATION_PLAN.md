# IMPLEMENTATION_PLAN.md

## Delivery plan for the Spanish vocabulary retention PWA

**Goal:** Build a personal Spanish vocabulary-retention app using an AI
coding assistant, with local development by default and one low-cost AWS
environment for personal use.

**Operating principles** - Keep recurring costs low. - Work in small,
verifiable increments. - Do not provision AWS resources before local
workflows and the application skeleton work. - Use Terraform for cloud
infrastructure. - Use GitHub as the source of truth and GitHub Actions
for CI/CD. - Keep AI behind a replaceable provider interface. - Never
claim a test or deployment succeeded unless it actually ran and passed.

------------------------------------------------------------------------


## Confirmed MVP decisions (authoritative)

- Authentication: Amazon Cognito User Pools with email/password now. Sign in with Apple is deferred technical debt.
- AI: OpenAI API as the first provider, implemented behind the provider-neutral `AIProvider` interface. ChatGPT subscription and API billing are separate.
- Initial EC2 target: `t4g.nano` as an experiment only. Build images in GitHub Actions, not on EC2. Monitor memory and upgrade to `t4g.small` or larger if unstable.
- Environments: local Docker Compose plus one personal AWS environment.
- Domain/HTTPS: defer domain setup until cloud deployment is prepared, but HTTPS is mandatory before public use.
- Infrastructure and deployment: Terraform, GitHub, GitHub Actions, OIDC. No long-lived AWS credentials stored in GitHub.

## Phase 0 --- Decisions and repository bootstrap

### Tasks

-   [ ] Create a private GitHub repository.
-   [ ] Add `PRODUCT_SPEC.md`, `TECHNICAL_SPEC.md`, and this
    `IMPLEMENTATION_PLAN.md` under `docs/` or at repository root; choose
    one convention and use it consistently.
-   [ ] Add `.gitignore` for Node, Next.js, Docker, Terraform,
    environment files, logs, and local database data.
-   [ ] Add `.env.example` containing names and placeholders only.
-   [ ] Add README with project goals, prerequisites, local start
    commands, and security notes.
-   [ ] Choose Node.js version and package manager; pin them.
-   [ ] Add linting, formatting, TypeScript strict mode, and test
    runner.
-   [ ] Add a CI workflow that runs on pull requests and pushes.

### Acceptance criteria

-   [ ] Clean checkout can install dependencies using the README.
-   [ ] Lint, typecheck, tests, and production build run locally.
-   [ ] GitHub Actions runs the same checks.
-   [ ] No credentials, real `.env` files, database files, or Terraform
    state are committed.

### Do not do yet

-   Do not create paid AWS resources.
-   Do not implement all screens.
-   Do not connect a live AI provider.

------------------------------------------------------------------------

## Phase 1 --- Local development environment

### Tasks

-   [ ] Add a `Dockerfile` for the application.
-   [ ] Add `compose.yaml` for local SQLite and any required local
    services.
-   [ ] Keep the Next.js development server convenient for hot reload;
    production container behavior must also be tested.
-   [ ] Add health checks and persistent local database volume.
-   [ ] Add validated environment configuration and fail-fast startup
    for missing required settings.
-   [ ] Add a mock AI provider for deterministic local development and
    tests.
-   [ ] Document reset, migration, and test commands.

### Acceptance criteria

-   [ ] A developer can start the local database and app from documented
    commands.
-   [ ] Local app startup does not require AWS credentials.
-   [ ] Mock AI responses allow tests to run without paid API calls.
-   [ ] Restarting the containers does not erase local database data.
-   [ ] A deliberate reset command is documented.

------------------------------------------------------------------------

## Phase 2 --- Database schema and data-access layer

### Tasks

-   [ ] Implement versioned SQLite migrations for profiles, lessons,
    vocabulary items, word forms, topics, topic links, word sources,
    import batches/items, review states, attempts, and practice
    sessions.
-   [ ] Add indexes and constraints from `TECHNICAL_SPEC.md`.
-   [ ] Add a migration runner suitable for local development and
    production deployment.
-   [ ] Implement typed repositories for the core entities.
-   [ ] Add data validation and ownership checks.
-   [ ] Define deletion/archive behavior.
-   [ ] Add test fixtures and database integration tests.

### Acceptance criteria

-   [ ] An empty database can be created from migrations.
-   [ ] Migrations run repeatably and their order is documented.
-   [ ] Relationships and constraints reject invalid references.
-   [ ] Repository tests cover common reads, writes, and error cases.
-   [ ] The schema can be recreated without manual dashboard edits.

------------------------------------------------------------------------

## Phase 3 --- Authentication and account isolation

### Tasks

-   [ ] Integrate Amazon Cognito User Pools with Sign in with Apple for the initial
    technical design, or implement the equivalent agreed Apple OAuth
    flow if the architecture decision changes before coding.
-   [ ] Document Apple Developer configuration and callback URLs.
-   [ ] Implement server-side session verification and protected routes.
-   [ ] Implement profile creation/update behavior.
-   [ ] Add tests for unauthenticated access and user ownership.
-   [ ] Define sign-out and account deletion behavior.

### Acceptance criteria

-   [ ] Authenticated users can access only their own records.
-   [ ] Unauthenticated requests to protected APIs are rejected.
-   [ ] User A cannot read, update, or delete user B's records.
-   [ ] No Apple tokens or private credentials are stored unnecessarily.
-   [ ] Real Apple login is tested in the configured environment before
    calling the integration complete.

### Architecture checkpoint

The product has specified Apple login, while the low-cost AWS direction
suggests hosting the application and database on EC2. Decide before
implementation whether Amazon Cognito User Pools remains an external managed
dependency or whether Apple federation will be implemented through
Amazon Cognito. Do not implement both. Record the decision in
`TECHNICAL_SPEC.md`; update costs and setup steps accordingly.

------------------------------------------------------------------------

## Phase 4 --- Vocabulary CRUD and topic model

### Tasks

-   [ ] Implement create, list, detail, edit, and archive operations for
    vocabulary.
-   [ ] Implement topic creation and duplicate normalization.
-   [ ] Support multiple topics per word.
-   [ ] Support filters by part of speech, topic, status, due state, and
    text search.
-   [ ] Display lemma, translation, examples, forms, sources, and review
    summary.
-   [ ] Add empty, loading, error, and retry states.

### Acceptance criteria

-   [ ] User can manage words without AI.
-   [ ] Topic and part-of-speech filters are independent.
-   [ ] Word forms are attached to the lemma instead of becoming
    accidental duplicate words.
-   [ ] Data remains available after reload and sign-in.
-   [ ] CRUD and filter tests pass.

------------------------------------------------------------------------

## Phase 5 --- AI provider abstraction

### Tasks

-   [ ] Define the provider-neutral TypeScript interface.
-   [ ] Define runtime schemas for every provider output.
-   [ ] Implement the mock provider first.
-   [ ] Implement one real provider adapter behind the interface.
-   [ ] Add provider configuration through server-side environment
    variables.
-   [ ] Add timeout, retry, rate-limit, and safe error handling.
-   [ ] Keep provider-specific types and SDK imports inside the adapter.
-   [ ] Add contract tests that run against the mock provider.

### Acceptance criteria

-   [ ] Domain services do not import vendor-specific AI SDKs.
-   [ ] Malformed model output is rejected or safely marked for review.
-   [ ] Provider failure does not corrupt saved vocabulary.
-   [ ] Tests do not require live AI requests.
-   [ ] Switching providers requires changing adapter/configuration, not
    domain logic.

------------------------------------------------------------------------

## Phase 6 --- Free-text import workflow

### Tasks

-   [ ] Build a large free-text input screen.
-   [ ] Create and persist an import batch before or as part of
    processing.
-   [ ] Parse text into proposals for lemmas, translations, parts of
    speech, topics, forms, and examples.
-   [ ] Compare proposals with a bounded set of existing vocabulary
    candidates.
-   [ ] Show uncertain items and likely duplicates for user review.
-   [ ] Allow editing, creating, merging, and skipping proposals.
-   [ ] Confirm an import in a transaction.
-   [ ] Make confirmation idempotent and recoverable after network
    retries.
-   [ ] Add input-size limits and AI request limits.

### Acceptance criteria

-   [ ] A sample free-form list becomes editable structured proposals.
-   [ ] User can correct AI mistakes before saving.
-   [ ] Retrying confirmation does not create duplicates.
-   [ ] Failed AI processing can be retried without losing the raw
    import.
-   [ ] Existing vocabulary remains unchanged if confirmation fails.

------------------------------------------------------------------------

## Phase 7 --- Review scheduler and practice engine

### Tasks

-   [ ] Implement deterministic review-state transitions.
-   [ ] Implement due-word selection and a target of about five new
    words per session.
-   [ ] Build a session flow with one exercise at a time.
-   [ ] Start with multiple choice, recall from translation, and cloze
    exercises.
-   [ ] Record independent recall, hint-assisted answer, wrong answer,
    and skip separately.
-   [ ] Implement feedback and a short reinforcement step after
    mistakes.
-   [ ] Use AI for open-ended evaluation only when needed.
-   [ ] Add session completion and summary.
-   [ ] Add tests for interval updates and edge cases.

### Acceptance criteria

-   [ ] Session target duration is about three minutes but not enforced
    as a timer.
-   [ ] Due reviews are considered before introducing excessive new
    material.
-   [ ] A hint-assisted answer is not treated as independent recall.
-   [ ] A single correct answer does not permanently master a word.
-   [ ] Attempts persist and affect subsequent scheduling.
-   [ ] An uncertain AI evaluation does not automatically punish the
    user.

------------------------------------------------------------------------

## Phase 8 --- PWA usability

### Tasks

-   [ ] Add manifest, app icons, theme color, and install instructions.
-   [ ] Make primary screens responsive for iPhone Safari.
-   [ ] Ensure all interactions work with touch and keyboard
    accessibility where applicable.
-   [ ] Add network/sync error states.
-   [ ] Cache only safe static assets by default.
-   [ ] Avoid caching authenticated API responses or private vocabulary.
-   [ ] Test installation and sign-in on a physical iPhone.

### Acceptance criteria

-   [ ] App can be installed on the iPhone home screen.
-   [ ] Practice and import flows work on a small viewport.
-   [ ] Private data is not unintentionally cached by the service
    worker.
-   [ ] The app communicates failed saves and network errors clearly.

------------------------------------------------------------------------

## Phase 9 --- Terraform bootstrap and AWS design

**Start this phase only after local app, database migrations, and CI
work.**

### Tasks

-   [ ] Confirm AWS region and instance architecture.
-   [ ] Confirm the auth decision: external Amazon Cognito User Pools or Amazon
    Cognito federation with Apple; do not build both.
-   [ ] Create a one-time Terraform bootstrap procedure for remote
    state.
-   [ ] Create a private, encrypted, versioned S3 bucket for Terraform
    state.
-   [ ] Configure state locking according to the chosen Terraform
    version.
-   [ ] Create an IAM role for GitHub Actions using OIDC with least
    privilege.
-   [ ] Create a small EC2 instance, security group, persistent EBS
    storage, and required IAM instance role.
-   [ ] Ensure SQLite is not publicly accessible.
-   [ ] Add a domain and HTTPS setup only when the domain is available.
-   [ ] Add private S3 backup storage and lifecycle retention.
-   [ ] Configure AWS Budget alerts.
-   [ ] Document estimated recurring costs and resources that continue
    to incur charges.

### Acceptance criteria

-   [ ] Infrastructure can be created from Terraform after the
    documented bootstrap.
-   [ ] Terraform state is not stored in Git.
-   [ ] GitHub Actions does not use permanent AWS access keys.
-   [ ] Only required ports are exposed.
-   [ ] The database is accessible only through local/private
    networking.
-   [ ] Budget alerts are configured.
-   [ ] Terraform plan is reviewed before applying changes.

### Cost controls

-   No RDS, NAT Gateway, ECS, or Application Load Balancer for the
    initial single-instance design unless explicitly justified.
-   No always-on AWS development environment.
-   Keep logs and backups under retention limits.
-   Remember that stopping EC2 does not stop charges for EBS volumes,
    snapshots, allocated public IPv4 addresses, or other retained
    resources.

------------------------------------------------------------------------

## Phase 10 --- GitHub Actions deployment to EC2

### Tasks

-   [ ] Build and test the production image in CI.
-   [ ] Publish the image to Amazon ECR, or use another documented
    secure artifact transfer approach.
-   [ ] Use GitHub OIDC to obtain short-lived AWS credentials.
-   [ ] Use AWS Systems Manager to trigger deployment on EC2 where
    practical.
-   [ ] Deploy only from the agreed branch and after successful CI.
-   [ ] Run migrations as an explicit controlled step.
-   [ ] Check application health after deployment.
-   [ ] Preserve the previous image and document rollback.
-   [ ] Keep production secrets out of workflow logs.
-   [ ] Add a manual approval gate for infrastructure changes and
    destructive operations.

### Acceptance criteria

-   [ ] A successful merge can deploy the tested application.
-   [ ] Failed CI blocks deployment.
-   [ ] Failed deployment is reported and does not silently mark the
    release successful.
-   [ ] Rollback steps are documented and tested at least once.
-   [ ] No long-lived AWS credentials are stored in GitHub.

------------------------------------------------------------------------

## Phase 11 --- Backups, recovery, and personal release

### Tasks

-   [ ] Schedule SQLite backups to private S3.
-   [ ] Apply backup retention/lifecycle rules.
-   [ ] Test restoration into a separate database.
-   [ ] Document instance replacement and recovery.
-   [ ] Configure basic CloudWatch logs/alarms without unlimited
    retention.
-   [ ] Verify HTTPS, Apple sign-in, PWA installation, import, practice,
    and cross-device sync.
-   [ ] Review AWS bill after the first week and first month.
-   [ ] Record known limitations.

### Acceptance criteria

-   [ ] Backup restore is proven, not merely configured.
-   [ ] The app can be recovered after losing the EC2 instance using
    documented steps.
-   [ ] All critical user journeys pass on iPhone.
-   [ ] Actual costs are compared with the target budget and adjusted if
    needed.

------------------------------------------------------------------------

## Phase 12 --- Optional later improvements

Do not implement these until the core MVP is reliable: - Apple Shortcuts
voice capture. - OCR for screenshots and lesson photos. - Direct
integration with a tutor platform. - Native iOS app or deeper Siri
integration. - More languages. - Advanced analytics and adaptive
scheduling experiments. - Moving SQLite to RDS if reliability or
maintenance requirements justify the additional cost.

------------------------------------------------------------------------

## Definition of done for every task

A task is complete only when: 1. The implementation matches the
documented requirement. 2. Tests for the changed behavior have been
added or updated. 3. Lint, typecheck, and relevant tests have actually
run. 4. Security and data ownership implications have been considered.
5. Documentation and this checklist are updated. 6. Remaining
limitations are explicitly stated.

Do not mark tasks complete based only on code generation.
