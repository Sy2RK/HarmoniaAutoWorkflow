# Code Review And Git Agent Handbook

Last updated: 2026-06-04 13:31:00 CST

This document is the code-review and Git coordination record for Harmonia Auto Workflow. Code review / release agents should read this before preparing commits, changing repository hygiene, pushing to GitHub, or declaring the project ready for handoff.

## Update Protocol

- Update this file after every meaningful review, validation, repository hygiene, secret-scan, Git, or handoff step.
- Keep `Current Progress` concise and current.
- Append a dated item to `Progress Log` whenever a step changes code, changes ignore rules, discovers a review finding, verifies behavior, scans for sensitive data, changes Git state, or changes push/commit readiness.
- Coordinate with `docs/backend-agent.md` and `docs/frontend-agent.md` when a finding affects backend behavior, frontend behavior, or shared API contracts.

## Review Scope

- Monorepo root configuration: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `.env.example`, `docker-compose.yml`
- Backend service: `apps/api`
- Frontend service: `apps/web`
- Shared contracts: `packages/shared`
- Agent coordination docs: `docs`
- Generated artifacts and local runtime data that must not be committed: `node_modules`, `dist`, `dist-types`, `.env`, local storage, logs, coverage, caches

## Repository Target

- GitHub repository requested by user: `https://github.com/Sy2RK/HarmoniaAutoWorkflow.git`
- Current local state: project directory is not yet initialized as a Git repository; `git status` and `git remote -v` fail until `.git` is created or the project is cloned into a Git worktree.

## Product And Architecture Summary

Harmonia Auto Workflow is an internal college Outlook public mailbox automation console. It syncs email through Microsoft Graph, classifies and processes business mail, can generate/review reply drafts, forward summaries to owners, and exposes an internal React operations UI.

- Package manager/workspace: pnpm monorepo.
- Backend: Node.js + TypeScript ESM + Fastify + zod, with Postgres and in-memory test repositories.
- Frontend: React 19 + Vite 6 + React Router + lucide icons.
- Shared package: TypeScript source of truth for categories, statuses, and API-facing types.
- Validation gate: `pnpm review` runs lint, typecheck, tests, and build.

## Current Progress

- Starting follow-up fix pass for the four initial code review findings.
- Confirmed the worktree is clean on `main...origin/main`.
- Implemented backend draft lifecycle state gates, manual process idempotency gate, configurable secure session cookie, and quiet test-process logging.
- Implemented frontend pending-only draft review loading/actions, logout auth-state reset, and disabled manual reprocess action for non-reprocessable message states.
- Added API tests for secure production cookies, terminal draft action blocking, and completed-message reprocess blocking.
- Ran targeted validation: API tests, API typecheck, and web typecheck passed.
- Ran full validation gate: `pnpm review` passed.
- Next step: final staged sensitive-content check, commit, and push the fix.

## Initial Code Review Findings

1. High: Draft sending is not status-gated. `POST /drafts/:id/send` sends any existing draft without checking whether it is already `sent`, `rejected`, `manual_required`, or `no_reply_needed` (`apps/api/src/app.ts:175`). The review page also loads every draft without a status filter (`apps/web/src/pages/DraftReviewPage.tsx:15`) and renders send/reject/no-reply/manual actions for all of them (`apps/web/src/pages/DraftReviewPage.tsx:55`). With mail sending enabled, an already-sent draft can be saved and sent again from the UI/API.

2. High: Manual reprocessing is not idempotency-gated. `POST /messages/:id/process` calls `processMessage` for any message state (`apps/api/src/app.ts:145`). The processor can notify owners, create forward records, and auto-reply depending on category. Re-clicking the detail-page process action can therefore duplicate outbound notifications or auto replies when mail sending is enabled.

3. Medium: Production session cookies are always created with `secure: false` (`apps/api/src/auth/session.ts:57`). This is fine for local HTTP development, but a deployed HTTPS environment should derive the `secure` flag from production/TLS config; otherwise session cookies can be sent over insecure transport if the site is exposed over HTTP.

4. Medium: Logout does not clear the top-level React auth state. `Layout` calls `/auth/logout` and navigates to `/login` (`apps/web/src/components/Layout.tsx:25`), but the `App` state that controls protected routes is owned above `Layout`. This can leave stale protected shell state until the page reloads or `/auth/me` is rechecked.

## Initial Watch Items

- `.env` exists locally and must never be committed.
- Generated build artifacts are present under `apps/api/dist`, `apps/web/dist`, `apps/web/dist-types`, and `packages/shared/dist`; ignore rules should cover these paths before repository initialization or staging.
- `storage/attachments/*` and `storage/msal-cache.json` are currently ignored, but the `storage` directory may still need an intentional placeholder rule if an empty directory must be kept.
- Because this folder is not yet a Git repository, commit/push steps require `git init`, a remote add, and a careful first staging pass after ignore rules are confirmed.

## Progress Log

### 2026-06-04 12:00:00 CST

- Read `README.md`, root `package.json`, package manifests for API/web/shared, `.gitignore`, `docs/frontend-agent.md`, and `docs/backend-agent.md`.
- Confirmed architecture shape: pnpm monorepo with Fastify API, React/Vite web app, and shared TypeScript contracts.
- Confirmed Git state: no `.git` directory is present in the current project folder.
- Created this Code Review and Git agent handbook for cross-agent progress synchronization.

### 2026-06-04 12:03:00 CST

- Reviewed backend startup/config, Fastify routes, auth/session handling, business processor, sync worker, Postgres and in-memory repositories, schema, Microsoft Graph integration, outbound mail adapter, AI adapter, attachment storage, shared contracts, frontend API client, and key frontend pages.
- Ran redacted sensitive-file checks. Confirmed `.env` is local-only material and must remain ignored; no `storage/msal-cache.json` or attachment files are currently present.
- Ran `pnpm review`; lint, typecheck, tests, and build all passed.

### 2026-06-04 12:05:00 CST

- Updated `.gitignore` to ignore local secrets (`.env`, `.env.*` except `.env.example`), nested `node_modules`, generated `dist` and `dist-types`, TypeScript build info, Vite/tool caches, logs, and runtime `storage` contents.
- Added `storage/.gitkeep` so the runtime storage directory can exist in fresh checkouts without committing token caches or attachments.

### 2026-06-04 12:08:00 CST

- Probed `https://github.com/Sy2RK/HarmoniaAutoWorkflow.git`; command succeeded and returned no heads, consistent with an empty target repository.
- Initialized the local directory as a Git repository on branch `main`.
- Added `origin` remote pointing to the requested GitHub repository.
- Verified ignore rules with `git check-ignore`: `.env`, nested `node_modules`, app/package `dist`, web `dist-types`, and `storage/msal-cache.json` are ignored; `.env.example` and `storage/.gitkeep` are intentionally not ignored.

### 2026-06-04 12:11:00 CST

- Staged the initial repository snapshot with `git add -A`.
- Confirmed staged paths do not include `.env`, dependency folders, build outputs, `dist-types`, Vite caches, token cache, logs, or storage attachments.
- Ran staged broad sensitive-keyword scan. Matches were configuration examples, variable names, source code references, docs, and lockfile content.
- Ran staged high-confidence token/private-key pattern scan. No matches found.
- Ran `git diff --cached --check`; no whitespace/error findings.

### 2026-06-04 12:14:00 CST

- Recorded the initial code review findings in this document, focused on duplicate-send risk, process idempotency, production cookie security, and stale frontend auth state.
- No functional bug fixes were applied in this pass; scope remained initial review, repository hygiene, sensitive-data safety, and first Git submission.

### 2026-06-04 12:17:00 CST

- Created the local root commit for the initial Harmonia Auto Workflow snapshot.
- Noted that Git auto-derived a local hostname email for the commit identity. To avoid exposing local machine identity, the next step is to set repository-local Git identity to `Sy2RK` / `Sy2RK@users.noreply.github.com` and amend the commit before pushing.

### 2026-06-04 12:19:00 CST

- Set repository-local Git identity to `Sy2RK` / `Sy2RK@users.noreply.github.com`.
- Amended the initial commit with the sanitized author and committer identity.
- Verified the latest commit identity no longer contains the local machine hostname email.

### 2026-06-04 12:24:00 CST

- First push attempt to `origin/main` failed with a transient GitHub HTTP 408 and did not create a remote head.
- Retried `git push -u origin main`; push succeeded and local `main` now tracks `origin/main`.
- This progress update records the completed Git submission for other agents.

### 2026-06-04 12:30:00 CST

- User requested completion of the previously identified fixes.
- Rechecked `git status --short --branch`; worktree is clean and local `main` tracks `origin/main`.
- Planned implementation: add backend guards for draft actions and message reprocessing, make session cookie secure behavior configurable, restrict frontend draft review to actionable drafts, and clear top-level auth state on logout.

### 2026-06-04 13:28:00 CST

- Backend changes:
  - Added shared enum validation for `/drafts?status=`.
  - Added editable/sendable draft state guards so terminal drafts cannot be saved, sent, rejected, marked manual, or marked no-reply.
  - Added `MESSAGE_ALREADY_PROCESSED` 409 guard so manual `POST /messages/:id/process` only runs for `new` and `failed` messages.
  - Added `SESSION_COOKIE_SECURE` support; cookie `Secure` defaults to true when `NODE_ENV=production`, unless explicitly configured.
  - Kept unit-test process logs quiet even when a test constructs a production-like app config.
- Frontend changes:
  - Draft review loads only `draft`, `saved`, and `manual_required` drafts through status-filtered API calls.
  - Manual-required drafts no longer show an enabled duplicate "mark manual" action.
  - Logout now notifies the top-level app shell to clear auth state before navigating to `/login`.
  - Message detail only enables manual reprocess for `new` and `failed` statuses and surfaces API errors.
- Test changes:
  - Added API coverage for production secure cookies, terminal draft action blocking, and completed-message reprocess blocking.
  - Targeted validation passed: `pnpm --filter @harmonia/api test`, `pnpm --filter @harmonia/api typecheck`, and `pnpm --filter @harmonia/web typecheck`.

### 2026-06-04 13:31:00 CST

- Ran full `pnpm review`; lint, typecheck, tests, and build all passed.
- Reviewed the diff and confirmed the change set is scoped to the four review fixes, API tests, `.env.example` cookie documentation, and this progress document.
- Confirmed generated build outputs and local `.env` remain ignored.
