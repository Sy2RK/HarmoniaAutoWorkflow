# Backend Agent Handbook

Last updated: 2026-06-04 11:54:34 CST

This document is the backend-only coordination record for Harmonia Auto Workflow. Backend agents should read this before changing `apps/api`, backend-facing `packages/shared` contracts, database schema, mail sync behavior, AI processing logic, or API behavior consumed by the frontend.

## Update Protocol

- Update this file after every meaningful backend development step.
- Keep `Current Progress` concise and current.
- Append a dated item to `Progress Log` whenever a step changes code, verifies behavior, discovers a backend/frontend contract issue, changes schema, changes business rules, or changes an operational decision.
- If a frontend change is needed, record the backend reason and expected UI/API impact here before handing it to a frontend agent.
- Do not use this file for broad frontend implementation notes except where they affect backend behavior or contracts.

## Backend Scope

- API service: `apps/api`
- API entrypoint: `apps/api/src/index.ts`
- Fastify app and route definitions: `apps/api/src/app.ts`
- Repository port: `apps/api/src/db/repository.ts`
- Postgres implementation and schema: `apps/api/src/db/postgres.ts`, `apps/api/src/db/schema.sql`
- In-memory test repository: `apps/api/src/db/memory.ts`
- Business workflow processor: `apps/api/src/business/processor.ts`
- Mail sync worker: `apps/api/src/worker/sync.ts`
- Microsoft Graph integration: `apps/api/src/graph`
- Outbound mail adapter: `apps/api/src/mail/outbound.ts`
- AI adapter: `apps/api/src/ai/client.ts`
- Shared frontend/backend types: `packages/shared/src/index.ts`

## Product Shape

Harmonia is an internal college public mailbox workflow system. Backend behavior should prioritize correctness, auditability, safe mail sending, predictable workflow state transitions, and clear handoff to human review.

Avoid surprising automatic actions. Any path that sends mail, marks work completed, changes review status, or notifies an owner should be explicit, logged, and covered by tests when behavior changes.

## Backend Architecture

- Runtime: Node.js + TypeScript ESM.
- API framework: Fastify.
- Validation: zod schemas inside `apps/api/src/app.ts`.
- Auth model: local admin account with HMAC-signed HTTP-only cookie session.
- Data model: Postgres tables created by `apps/api/src/db/schema.sql`.
- Repository pattern: `AppRepository` is the backend data port; business logic should depend on this interface instead of SQL directly.
- Testing: Vitest uses `InMemoryRepository` plus fake Graph, mailer, and AI clients.
- External mail source: Microsoft Graph delta sync.
- Outbound mail: `GraphOutboundMailer`, gated by `MAIL_SENDING_ENABLED`.
- AI: OpenAI-compatible text and vision providers, with `NoopAiClient` fallback when disabled.

## Backend Flow Map

Main startup flow:

- `apps/api/src/index.ts` loads env, initializes `PostgresRepository`, runs migration, ensures admin user, builds Graph/mailer/AI clients, builds Fastify app, starts sync worker, then listens on `PORT`.

Mail sync flow:

- `syncMailbox` reads app settings.
- If sync is disabled or mailbox is empty, it returns `{ received: 0, processed: 0 }`.
- Otherwise it reads Graph delta, upserts messages, downloads file attachments, skips already processed non-failed messages, and calls `processMessage`.
- Failures are stored on the message with status `failed`, `needsReview: true`, and an audit log.

Message processing flow:

- Set message status to `processing`.
- Classify by local rules first, then AI if rules return `other`.
- Extract structured fields by rules and AI merge.
- Route category to the matching handler:
  - `checkout`: create reviewed reply draft; incomplete data becomes `manual_required`.
  - `party_consultation` and `admission_consultation`: match knowledge base; hit creates reviewed draft, miss goes manual.
  - `room_usage`: validate room rules, notify owner, auto-reply only when auto-approve is enabled and outbound send succeeds.
  - `scholarship`: compare body data with image OCR and forward overview to owner.
  - `tutor_report`, `dorm_transfer`, `tutor_application`: create overview and forward to configured owner.
  - `other`: notify default/manual owner and mark manual.
- Append `message_processed` audit after successful processing.

## Frontend Contract Map

Frontend calls in `apps/web/src/api/client.ts` map to these backend routes in `apps/api/src/app.ts`:

- `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`
- `GET /dashboard`
- `GET /messages`, `GET /messages/:id`, `POST /messages/:id/process`
- `GET /drafts`, `PATCH /drafts/:id`, `POST /drafts/:id/send`, `POST /drafts/:id/reject`, `POST /drafts/:id/manual`, `POST /drafts/:id/no-reply`
- `GET /forward-records`
- `GET /settings`, `PATCH /settings`
- `GET /knowledge-base`, `POST /knowledge-base`
- `POST /sync/run`

Shared shape source of truth:

- Mail categories and labels: `mailCategories`, `mailCategoryLabels`
- Mail processing statuses: `processingStatuses`
- Draft statuses: `draftStatuses`
- Core response types: `MailMessage`, `ReplyDraft`, `ForwardRecord`, `DashboardSummary`, `AppSettings`, `KnowledgeEntry`, `ApiListResponse<T>`

Backend agents must update `packages/shared/src/index.ts` and `apps/web/src/api/client.ts` expectations together when API response shapes change.

## Current Progress

- Completed initial backend/frontend orientation.
- Confirmed backend API routes, repository interface, Postgres schema, business processor, Graph integration, mailer, AI adapter, and frontend API client alignment.
- Confirmed shared TypeScript contracts are the current source of truth for frontend/backend shape matching.
- Confirmed current typecheck and API tests pass.
- Created this backend agent handbook as the persistent progress sync surface.

## Known Backend Risks

- `POST /messages/:id/process` can re-run workflow logic and may create repeated owner notifications or auto-send attempts depending on category and mailer state. Treat idempotency as a first-class concern.
- Database migration is currently a single `schema.sql` with `create table if not exists`; field changes need a migration strategy before production evolution.
- Most settings email fields are plain strings. Invalid owner/default/manual mailbox values can cause downstream send failures.
- `/drafts?status=` accepts any string cast to `DraftStatus`; invalid statuses should be validated if exposed more broadly.
- Date filters compare raw `received_at >= from` and `received_at <= to`; frontend date-only `to` values may exclude messages later on the selected end date.
- Session cookies are `secure: false`; production deployment should revisit cookie security and same-site behavior.
- Outbound mail actions are only skipped by `MAIL_SENDING_ENABLED=false`; always verify this flag before testing flows that can send real mail.
- There is no OpenAPI/schema contract test yet. Current contract safety mainly comes from shared TypeScript types, API tests, and build/typecheck.

## Validation Baseline

Last verified on 2026-06-04:

- `pnpm typecheck`
- `pnpm --filter @harmonia/api test`

All passed.

## Progress Log

### 2026-06-04 11:54:34 CST

- Read existing `docs/frontend-agent.md` to align agent coordination conventions.
- Created this backend agent handbook for persistent backend progress synchronization.
- Recorded the current backend architecture, frontend contract map, current progress, known backend risks, and validation baseline.
