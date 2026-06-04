# Code Review And Git Agent Handbook

Last updated: 2026-06-04 12:24:00 CST

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

- Read root project structure, README, package manifests, `.gitignore`, existing frontend/backend agent handbooks, backend workflow code, database repository code, external Graph/AI/mail adapters, frontend API client, key frontend pages, and API tests.
- Confirmed current directory is not a Git repository yet.
- Created this code-review/Git coordination document.
- Ran a redacted sensitive-file scan: `.env` exists locally and contains runtime keys/credentials by variable name, but values were not printed; no token or attachment files were found under `storage`.
- Ran the full review gate successfully: `pnpm review`.
- Tightened `.gitignore` to cover nested dependencies, generated artifacts, local env files, tool caches, logs, and runtime storage while keeping `.env.example` and `storage/.gitkeep`.
- Initialized Git on branch `main` and added `origin` remote `https://github.com/Sy2RK/HarmoniaAutoWorkflow.git`.
- Verified ignore behavior: `.env`, nested dependencies, `dist`, `dist-types`, token cache paths, and generated package dist outputs are ignored; `.env.example` and `storage/.gitkeep` remain visible for commit.
- Staged the initial repository file set and confirmed no ignored/generated/runtime-secret paths are staged.
- Ran staged sensitive-content checks. Only variable-name/config-reference files matched broad keywords; common real token/private-key patterns had no matches.
- Recorded initial code review findings below. No functional fixes were applied in this pass except repository hygiene and documentation.
- Created the local initial commit.
- Git initially auto-derived a local hostname email for the committer; repository-local Git identity was reset to `Sy2RK` / `Sy2RK@users.noreply.github.com`, and the commit was amended before push.
- Pushed the sanitized initial snapshot to `origin/main` after one transient HTTP 408 retry.
- Next step: keep this document updated for any follow-up code review fixes or Git submissions.

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
