# Backend Agent Handbook

Last updated: 2026-06-16 15:38:00 CST

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
- Scholarship check module: `apps/api/src/scholarship-check`
- Award confidence module: `apps/api/src/award-confidence`
- Repository port: `apps/api/src/db/repository.ts`
- Repository factory: `apps/api/src/db/factory.ts`
- SQLite implementation and schema: `apps/api/src/db/sqlite.ts`, `apps/api/src/db/schema.sqlite.sql`
- Optional Postgres implementation and schema: `apps/api/src/db/postgres.ts`, `apps/api/src/db/schema.sql`
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
- Default local admins: `ADMIN_EMAIL`/`ADMIN_PASSWORD` plus optional JSON `ADMIN_USERS`.
- Data model: SQLite file storage by default, with optional Postgres selected by `DB_DRIVER=postgres`.
- Repository pattern: `AppRepository` is the backend data port; business logic should depend on this interface instead of SQL directly.
- Testing: Vitest uses `InMemoryRepository` plus fake Graph, mailer, and AI clients.
- External mail source: Microsoft Graph delta sync.
- Outbound mail: `GraphOutboundMailer`, gated by `MAIL_SENDING_ENABLED`.
- AI: OpenAI-compatible text and vision providers, with `NoopAiClient` fallback when disabled.

## Backend Flow Map

Main startup flow:

- `apps/api/src/index.ts` loads env, initializes the selected repository through `createRepository`, runs migration, ensures admin user, builds Graph/mailer/AI clients, builds Fastify app, starts sync worker, then listens on `PORT`.

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

- Completed SQLite local-deployment backend refactor.
- Confirmed backend API routes, repository interface, SQLite/Postgres schemas, business processor, Graph integration, mailer, AI adapter, and frontend API client alignment.
- Confirmed shared TypeScript contracts are the current source of truth for frontend/backend shape matching.
- Confirmed full review gate passes after SQLite repository additions.
- Created this backend agent handbook as the persistent progress sync surface.

## Known Backend Risks

- `POST /messages/:id/process` can re-run workflow logic and may create repeated owner notifications or auto-send attempts depending on category and mailer state. Treat idempotency as a first-class concern.
- Database migrations are currently schema bootstrap files with `create table if not exists`; field changes need a migration strategy before production evolution.
- SQLite is the default single-machine store. Use `DB_DRIVER=postgres` for multi-instance or higher-concurrency deployments.
- Most settings email fields are plain strings. Invalid owner/default/manual mailbox values can cause downstream send failures.
- `/drafts?status=` accepts any string cast to `DraftStatus`; invalid statuses should be validated if exposed more broadly.
- Date filters compare raw `received_at >= from` and `received_at <= to`; frontend date-only `to` values may exclude messages later on the selected end date.
- Session cookies are `secure: false`; production deployment should revisit cookie security and same-site behavior.
- Outbound mail actions are only skipped by `MAIL_SENDING_ENABLED=false`; always verify this flag before testing flows that can send real mail.
- There is no OpenAPI/schema contract test yet. Current contract safety mainly comes from shared TypeScript types, API tests, and build/typecheck.

## Validation Baseline

Last verified on 2026-06-16:

- `pnpm --filter @harmonia/api test`
- `pnpm --filter @harmonia/api typecheck`
- `pnpm --filter @harmonia/web typecheck`
- `pnpm review`

All passed.

## Progress Log

### 2026-06-04 11:54:34 CST

- Read existing `docs/frontend-agent.md` to align agent coordination conventions.
- Created this backend agent handbook for persistent backend progress synchronization.
- Recorded the current backend architecture, frontend contract map, current progress, known backend risks, and validation baseline.

### 2026-06-16 12:00:00 CST

- Added `DB_DRIVER=sqlite|postgres` and `SQLITE_DB_PATH`, with SQLite as the default local backend.
- Added `createRepository` and a SQLite-backed `AppRepository` implementation using `sql.js`, avoiding native Windows SQLite build requirements while persisting to `storage/harmonia.sqlite`.
- Kept Postgres available through `DB_DRIVER=postgres`; Docker Compose now sets that explicitly.
- Added SQLite schema, repository contract coverage, and SQLite-backed API persistence smoke coverage.
- Updated README, `.env.example`, API Dockerfile schema copies, and backend coordination notes for no-Docker local deployment.
- Verified local API and web dev servers start without Docker; `/health` returned ok, default login succeeded, and `storage/harmonia.sqlite` was created.
- Ran validation: API tests, API typecheck, web typecheck, and full `pnpm review` all passed.

### 2026-06-16 14:58:00 CST

- Added `ADMIN_USERS` JSON config for extra local admin accounts while preserving `ADMIN_EMAIL`/`ADMIN_PASSWORD`.
- Created local `.env` with two requested Outlook admin accounts; `.env` remains ignored by Git.
- Restarted the local API server, confirmed both requested accounts were inserted into SQLite, and verified both logins return HTTP 200.
- Ran validation: `pnpm --filter @harmonia/api typecheck` and `pnpm --filter @harmonia/api test` passed.

### 2026-06-16 15:38:00 CST

- Implemented the independent scholarship/outstanding graduate material check backend module.
- Added authenticated multipart job creation, job polling, and result workbook download routes under `/scholarship-check`.
- Added source workbook parsing, processed workbook generation, applicant evidence matching, category inference, and four-line remark output.
- Added shared scholarship check API types and backend coverage for workbook mapping, remark formatting, folder matching, invalid uploads, unknown downloads, background processing, and result download.
- Ran full validation: `pnpm review` passed.

### 2026-06-17 15:54:00 CST

- Implemented the independent award-confidence workbook backend module under `apps/api/src/award-confidence/`.
- Added authenticated multipart job creation, job polling, and result workbook download routes under `/award-confidence`.
- Added AI-backed workbook-only confidence scoring for first/second award applications: the AI judges each material subitem, then the backend applies the documented weighted formula.
- Added shared award-confidence API types and backend coverage for wrapped headers, output workbook columns, blank second awards, AI subitem scoring, risk penalties, award profile weights, and invalid uploads.
- Moved automatic test storage roots for background-job modules to OS temp directories unless a test explicitly injects a storage root, preventing parallel tests from deleting another app instance's runtime files.
- Fixed a scholarship-check pause/resume race where a resume request arriving before the old worker exited could be swallowed by the active-process guard.
- Validation passed: `pnpm --filter @harmonia/api typecheck`, `pnpm --filter @harmonia/api test`, and `pnpm review`.

### 2026-06-17 Award Confidence History

- Added persistent recent-record indexing for award-confidence jobs under `storage/award-confidence/index.json`.
- Added `GET /award-confidence/jobs?limit=5` and wired delete to remove jobs from both storage and the recent-record index.
- Award-confidence history now matches the material-check retention rule: retain the latest five records and keep active records discoverable until completion or explicit deletion.
- Added backend coverage for award-confidence recent-list retention and deletion from the list.
- Validation passed: `pnpm --filter @harmonia/api test -- apps/api/test/awardConfidence.test.ts` and `pnpm --filter @harmonia/api typecheck`.

### 2026-06-25 Material Check Structured Output

- Split material-check row output into fixed-status `remark` and business-reason `detail`, while keeping `error` for technical failures.
- Updated the processed workbook to output both `核对情况备注` and `详细情况`.
- Updated manual row edits to save both fields and regenerate terminal result workbooks.
- Added backend tests for fixed statuses, AI mismatch/missing mapping, workbook columns, and edited-download persistence.

### 2026-06-25 CUHK Local Model Configuration

- Switched default OpenAI-compatible AI configuration to the CUHK local endpoint `https://ai-api.cuhk.edu.cn/v1` and default model `qwen3-5-397b-a17b`.
- Added persisted `scholarshipCheckAiModel` settings so admins can manually choose between `qwen3-5-397b-a17b` and `gemma-4-31B` for subsequent material-check and award-confidence jobs.

### 2026-06-25 College Knowledge Q&A Planning

- Added `docs/college-knowledge-backend-agent.md` as the backend-only requirements document for the new `书院知识问答` RAG-style module.
- Backend scope: authenticated `/college-knowledge` routes, document upload, parser/converter pipeline, canonical Markdown extraction, source-aware chunks, lexical retrieval without embeddings, LLM reranking, source-grounded answer generation, database/storage changes, shared types, and tests.
- Boundary: backend agents must not implement React pages, sidebar navigation, settings-page UI cleanup, or CSS; frontend work is specified in `docs/college-knowledge-frontend-agent.md`.

### 2026-06-25 Lenient Material Evidence Review

- Relaxed material-check evidence review so core applicant, award/project name, and year/academic-year matching is enough for `无问题`.
- Minor model-reported issues such as exact date absence, one-character typos, translation/abbreviation differences, near-synonym roles, same-entity name variants, screenshots, and informal proof format are retained in `详细情况` but no longer force `部分材料不匹配`.
- Hard conflicts still map to `部分材料不匹配`, including different applicant, completely different award/project, clear year/academic-year conflict, and award level/ranking conflict.

### 2026-06-25 College Knowledge Q&A Backend

- Implemented the backend-only college knowledge module under `apps/api/src/college-knowledge/`.
- Added authenticated `/college-knowledge` APIs for document listing, multipart upload, reindex, delete, JSON/multipart chat, image-question extraction, lexical retrieval, model rerank, and source-grounded answers.
- Added Markdown-normalizing parsers for `md`, `txt`, `csv`, `xlsx/xls`, `pdf`, `docx`, `pptx`, and zip archives; old `.doc`/`.ppt` files are recorded as unsupported documents.
- Added SQLite/Postgres/InMemory repository support for `college_knowledge_documents` and `college_knowledge_chunks`, including SHA-256 dedupe and full chunk replacement on reindex.
- Added shared college knowledge document/source/chat response types and OpenAI-compatible AI methods for image extraction, rerank, and answer generation.
- Added backend tests for upload, temp-file ignore, xlsx FAQ chunks, PDF page locators, docx/pptx locators, unsupported legacy Office files, reindex, delete, no-answer behavior, source citations, and multipart image chat.
- Validation passed: `pnpm --filter @harmonia/api test`, `pnpm --filter @harmonia/api typecheck`, `pnpm --filter @harmonia/web typecheck`, and `pnpm review`.
