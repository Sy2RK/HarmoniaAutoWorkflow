# Frontend Agent Handbook

Last updated: 2026-06-04 11:54:59 CST

This document is the frontend-only coordination record for Harmonia Auto Workflow. Frontend agents should read this before changing `apps/web`, `packages/shared`, or API-facing UI behavior.

## Update Protocol

- Update this file after every meaningful frontend development step.
- Keep `Current Progress` concise and current.
- Append a dated item to `Progress Log` whenever a step changes code, verifies behavior, discovers a frontend/API contract issue, or changes a design decision.
- If a backend/API change is needed, record the frontend reason and expected contract here before handing it to a backend agent.
- Do not use this file for broad backend implementation notes except where they affect frontend behavior.

## Cross-Agent Coordination

- Other specialist agents may maintain similar documents, for example backend, AI/OCR, or infrastructure notes.
- Before starting frontend work that touches API contracts, auth, data shape, environment config, workflow semantics, or deployment behavior, check the relevant agent documents in `docs/`.
- If another agent document records an in-progress contract change, treat it as the current coordination source until verified in code.
- When frontend work depends on another agent's pending change, record the dependency in this file under `Current Progress` or `Progress Log`.
- If frontend work discovers a mismatch with another agent's notes, document the mismatch here and cite the code path that currently wins.

## Frontend Scope

- Frontend app: `apps/web`
- Shared frontend/backend types: `packages/shared/src/index.ts`
- API client boundary: `apps/web/src/api/client.ts`
- Main router/auth shell: `apps/web/src/App.tsx`
- Layout and navigation: `apps/web/src/components/Layout.tsx`
- Global styling: `apps/web/src/styles/app.css`

## Product Shape

Harmonia is an internal college public mailbox workflow console. The UI should feel like a dense, calm operations tool: fast to scan, explicit about status, and careful around actions that send mail or change workflow state.

Avoid marketing-page patterns. Prefer restrained dashboard ergonomics, compact information hierarchy, stable table layouts, clear review states, and high-signal feedback after every action.

## Frontend Architecture

- Framework: React 19 + Vite 6.
- Routing: `react-router-dom`, with route definitions in `apps/web/src/App.tsx`.
- Auth model: cookie session. `api.me()` checks `/auth/me`; protected routes render through `Layout`.
- Data fetching: page-local `useEffect` calls through `apps/web/src/api/client.ts`.
- State management: local component state only; no shared client cache yet.
- Icons: `lucide-react`.
- Styling: one global stylesheet, `apps/web/src/styles/app.css`.

## Backend Contract Map

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

## Workflow Semantics For UI

Use workflow state, not category alone, to decide the UI.

- `checkout`, `party_consultation`, `admission_consultation`, and `room_usage` may create reply drafts.
- `room_usage` can become `auto_approved` when rules pass and mail sending succeeds.
- `tutor_report`, `dorm_transfer`, `tutor_application`, and `scholarship` are generally forwarded as summaries to owners.
- `other` and failed/incomplete cases tend toward `manual_required`.
- Draft actions can update both the draft and the parent message status.

Best UI rule: derive actions from `message.status`, `message.needsReview`, and whether `detail.draft` exists.

## Current Progress

- Implemented the independent `邮件写作 Agent` frontend route at `/message-agent` with sidebar navigation and keep-alive page state.
- Added a usable upload + chat + draft workflow: reference library upload, current request file upload, image/text chat, follow-up question cards, source references, editable subject/body, draft save, and DOCX download.
- Split `/message-agent` into `邮件写作` and `参考邮件库录入` tabs, defaulting to `邮件写作`; removed message-agent `快速` / `精准` controls and stopped sending a chat mode so the backend default is used.
- Corrected the message-agent upload boundary: reference/current request upload controls now accept and display only parseable documents (`.xlsx`, `.docx`, `.pdf`, `.md`, `.txt`, `.csv`); images are chat-only multimodal attachments, and `.msg`/old `.doc` selections are warned and ignored client-side.
- Added frontend API client methods for `/message-agent` sessions, file upload, chat, draft patch, DOCX download, and session delete while leaving parsing, template extraction, AI generation, DOCX generation, and mail sending to the backend.
- Latest frontend validation passed: `pnpm --filter @harmonia/web typecheck` and `pnpm --filter @harmonia/web build`.
- Implemented the `书院知识问答` frontend route at `/college-knowledge` with sidebar navigation and keep-alive page state.
- Added a two-tab college knowledge page: `知识问答` chat with optional image upload and source display, plus `知识文档录入` for file/folder upload, relative-path preservation, document status, reindex, and delete actions.
- Removed the Settings page `新增知识库` and `知识库条目` panels while keeping the legacy `知识库启用` setting toggle.
- Added frontend client methods for `GET /college-knowledge/documents`, document upload, reindex, delete, and multipart chat.
- Latest frontend validation passed: `pnpm --filter @harmonia/web typecheck` and `pnpm --filter @harmonia/web build`.
- Implemented the workbook-only award confidence frontend workflow inside `/scholarship-check` as a second tab named `奖项置信度`.
- Added award-confidence API client methods for `POST /award-confidence/jobs`, `GET /award-confidence/jobs/:id`, and `GET /award-confidence/jobs/:id/result`.
- The award confidence UI accepts one `.xlsx`, polls queued/processing jobs, previews confidence rows, formats scores to one decimal place, and enables result download when complete.
- Completed the 2026-06-17 scholarship-check frontend follow-up: recent five records, backend-backed active job recovery, localStorage last-selection convenience, pause/resume/cancel controls, delete confirmation, manual row remark editing, manual refresh, and terminal-record download handling.
- Added frontend API client methods for `GET /scholarship-check/jobs?limit=5`, row remark `PATCH`, job `DELETE`, and pause/resume/cancel lifecycle endpoints.
- Implemented the scholarship material check frontend for `/scholarship-check`.
- Added shared scholarship check job/row types and frontend API client methods for upload, polling, and result download.
- Added sidebar navigation for `奖学金核对` and a compact operations-console page for workbook/folder selection, job progress, row preview, and Excel download.
- Upgraded the scholarship check current-job progress display with a percentage progress bar and indeterminate queued/preparing state.
- Added a muted current-operation line below the scholarship check progress bar, inferred from job status and the row currently being processed.
- Changed protected left-nav pages to stay mounted after first visit, so switching sidebar sections no longer reinitializes page-local state.
- Verified the frontend contract against the backend scholarship-check routes now present under `apps/api/src/scholarship-check`.
- TypeScript API diagnostics for `apps/web` and `packages/shared` passed with 0 diagnostics; direct `pnpm` command validation is blocked because `node`, `pnpm`, and `corepack` are not available on PATH.
- Completed initial frontend/backend orientation.
- Confirmed frontend API client and backend Fastify routes are aligned at the TypeScript/type-contract level.
- Confirmed current frontend build passes.
- Confirmed backend typecheck and tests pass.
- Created this frontend agent handbook as the persistent progress sync surface.
- Added cross-agent coordination rules: frontend agent should inspect other specialist docs when work crosses frontend/backend boundaries.

## Known Frontend Risks

- Logout only navigates to `/login`; the `App` auth state is not reset in the shell, which may cause stale protected UI state after logout.
- Error handling is page-local and inconsistent. Several pages can remain in loading state or show raw backend JSON/text errors.
- Draft review currently calls `/drafts` without a status filter, so completed/rejected drafts may appear in the review workflow.
- Message date filter sends `to=YYYY-MM-DD`; backend compares `received_at <= to`, which may exclude messages later on the selected end date.
- `POST /sync/run` returns `{ received, processed }`, but the dashboard currently only refreshes data and does not surface the result.
- `.env.example` does not document `VITE_API_BASE_URL`; Docker Compose sets it for the web container.

## Validation Baseline

Last verified on 2026-06-04:

- `pnpm --filter @harmonia/web typecheck`
- `pnpm --filter @harmonia/api typecheck`
- `pnpm --filter @harmonia/api test`
- `pnpm --filter @harmonia/web build`

All passed.

## Progress Log

### 2026-06-04 11:51:59 CST

- Read project structure and identified the frontend/backend/shared package split.
- Reviewed frontend routes, API client, shared types, backend routes, repository behavior, and workflow processor state transitions.
- Verified current type and build health with frontend typecheck, API typecheck, API tests, and frontend production build.
- Added this document so future frontend development steps can be synchronized for other agents.

### 2026-06-04 11:54:59 CST

- Added the cross-agent coordination rule: frontend work should also consult other agent progress documents, such as backend notes, before changing shared contracts or dependent behavior.

### 2026-06-16 CST

- Read `docs/scholarship-check-frontend-agent.md` and `docs/scholarship-check-backend-agent.md`.
- Implemented `/scholarship-check` in `apps/web/src/pages/ScholarshipCheckPage.tsx` with `.xlsx` workbook selection, browser folder upload, evidence file counts by applicant folder, explicit job creation, 3-second polling, progress display, row preview, preserved remark line breaks, and completed-job Excel download.
- Added scholarship check shared types in `packages/shared/src/index.ts`.
- Added frontend API client methods for `POST /scholarship-check/jobs`, `GET /scholarship-check/jobs/:id`, and `GET /scholarship-check/jobs/:id/result`, preserving `evidencePaths` order and avoiding a forced JSON content type for multipart upload.
- Added the protected route and sidebar item for `奖学金核对`.
- Added page-specific CSS while keeping the current compact operations-console visual style.
- Added a clearer current-task progress bar for scholarship check jobs, including percentage text, accessible progressbar attributes, and an indeterminate visual state before applicant totals are known.
- Added a gray helper line under the scholarship check progress bar to show the current operation, such as queued, reading materials, checking a specific applicant, generating the workbook, completed, or failed.
- Refactored the protected route shell so top-level sidebar pages are keep-alive panels. Dashboard, messages, drafts, forward records, scholarship check, and settings remain mounted after first visit; message detail remains a normal route.
- Confirmed by source inspection that frontend field names and response shapes match the backend route implementation under `apps/api/src/scholarship-check`.
- Ran TypeScript compiler diagnostics through the available TypeScript API for `apps/web` and `packages/shared`; both returned 0 diagnostics.
- Could not run the direct `pnpm --filter @harmonia/web typecheck` shell command because this workspace shell does not currently expose Node.js, Corepack, or pnpm.

### 2026-06-17 CST

- Re-read `docs/scholarship-check-frontend-agent.md` and followed its frontend ownership boundary: no backend scholarship-check files were modified for this frontend pass.
- Extended `apps/web/src/api/client.ts` with recent-job listing, row remark update, delete, pause, resume, and cancel methods.
- Reworked `apps/web/src/pages/ScholarshipCheckPage.tsx` so `/scholarship-check` loads the latest five records, auto-selects the newest active or paused job on return, stores the last selected job ID in `localStorage`, keeps polling only queued/processing jobs, and allows manual refresh.
- Added lifecycle controls with explicit confirmation for cancellation, record deletion with confirmation, retained-record selection, terminal-record download attempts, and row-level remark editing that preserves the four-line structure before calling `PATCH`.
- Added CSS for recent records, compact lifecycle controls, paused/cancelled status states, and in-table remark editing while keeping the operations-console visual language.
- Attempted validation with `pnpm --filter @harmonia/web typecheck`, `node --version`, `corepack --version`, and `where.exe node/pnpm`; all failed because the commands are unavailable on PATH in this shell.

### 2026-06-17 Award Confidence Frontend

- Read the new Award Confidence Workbook Module UI section in `docs/scholarship-check-frontend-agent.md` and the recorded backend API surface in `docs/scholarship-check-backend-agent.md`.
- Added award-confidence client calls in `apps/web/src/api/client.ts` for create, poll, and result download.
- Reworked `apps/web/src/pages/ScholarshipCheckPage.tsx` into two tabs: `材料核对` for the existing proof-material workflow and `奖项置信度` for the new workbook-only workflow.
- The new tab validates `.xlsx` selection client-side, uploads only the workbook, polls queued/processing jobs, renders row preview columns for sheet/name/awards/confidence/status/error, formats confidence scores to one decimal place, and downloads `奖项置信度结果.xlsx` after completion.
- Added CSS for the segmented tabs, workbook status panel, award-confidence table, award job/row statuses, and confidence score bands.
- Validation: direct `pnpm`/`node` shell commands are unavailable on PATH; TypeScript diagnostics through the Node REPL reported only environment baseline issues for missing `vite/client` and `import.meta.env`, with no diagnostics in `ScholarshipCheckPage.tsx`.

### 2026-06-17 Award Confidence History

- Added award-confidence recent-record loading through `GET /award-confidence/jobs?limit=5`.
- Added a `最近置信度记录` panel with record selection, active/paused recovery on route return, manual refresh, selected-record highlighting, and per-record delete buttons.
- Removed award-confidence deletion from the current progress panel; `暂停`, `继续`, and `终止` remain process controls on the selected job.
- Deleting the selected confidence record clears the preview and reloads backend history; deleting another record leaves the selected preview in place.
- Validation passed: `pnpm --filter @harmonia/web typecheck`.

### 2026-06-25 Material Check Structured Output

- Replaced the material-check preview `错误` column with `详细情况`, leaving row-level technical `error` hidden from the table.
- Changed row editing from a freeform remark textarea to fixed-status selectors plus per-category detail text inputs.
- Updated the row edit API call to send both `remark` and `detail`.
- Validation passed: `pnpm --filter @harmonia/web typecheck`.

### 2026-06-25 Model Selection Configuration

- Added a persisted model selector to the configuration page for scholarship material checks and award-confidence jobs.
- The selector only exposes `qwen3-5-397b-a17b` and `gemma-4-31B`; API keys remain backend-local and are not sent to the frontend.

### 2026-06-25 College Knowledge Q&A Planning

- Added `docs/college-knowledge-frontend-agent.md` as the frontend-only requirements document for the new `书院知识问答` sidebar module.
- Frontend scope: add `/college-knowledge`, build chat and document-ingestion tabs, consume backend RAG API contracts, display answer sources, and remove the settings-page `新增知识库` / `知识库条目` panels.
- Boundary: frontend agents must not implement document parsing, Markdown conversion, chunking, retrieval, reranking, or answer generation.

### 2026-06-25 College Knowledge Q&A Frontend

- Added `/college-knowledge` as a keep-alive protected route and sidebar item labeled `书院知识问答`.
- Implemented `apps/web/src/pages/CollegeKnowledgePage.tsx` with `知识问答` and `知识文档录入` tabs, local-only chat/upload state, optional image upload for chat, source reference rendering, and document status actions.
- Extended `apps/web/src/api/client.ts` with college knowledge document list/upload/reindex/delete and multipart chat methods using shared `CollegeKnowledge*` types.
- Removed the Settings page `新增知识库` and `知识库条目` panels and the page-local `KnowledgeEntry` state/load flow; left `knowledgeBaseEnabled` intact for legacy email processing.
- Added college knowledge chat, source, upload, status, and responsive styles to `apps/web/src/styles/app.css`.
- Validation passed: `pnpm --filter @harmonia/web typecheck` and `pnpm --filter @harmonia/web build`.

### 2026-06-25 College Knowledge Chat Modes

- Added `快速` / `精准` mode selection to the `/college-knowledge` Q&A toolbar and persisted the selected mode across refreshes.
- Persisted visible chat turns in `localStorage` so refreshing the page no longer clears the conversation, and added a manual `清空会话` button.
- Extended `apps/web/src/api/client.ts` to send `mode` with college knowledge multipart chat requests; frontend remains limited to UI state and API calls.
- Validation passed: `pnpm --filter @harmonia/web typecheck`.

### 2026-06-29 Message Agent Planning

- Added `docs/message-agent-frontend-agent.md` as the frontend-only implementation brief for the independent `邮件写作 Agent` module.
- Frontend scope: `/message-agent` sidebar/page, reference upload UI, current request chat with files/images, follow-up question display, draft preview/editing, source display, and DOCX download.
- Boundary: frontend must not implement parsing, retrieval, template extraction, AI generation, DOCX generation, Outlook sending, or changes to the existing `书院知识问答` page.

### 2026-06-29 Message Agent Frontend

- Added `/message-agent` as a protected keep-alive route and sidebar item labeled `邮件写作 Agent`.
- Implemented `apps/web/src/pages/MessageAgentPage.tsx` with reference mail library upload, current request file upload, text/image chat, follow-up question rendering, warning display, source reference cards, and session clearing.
- Added editable draft preview for generated subject/body, manual save through `PATCH /message-agent/sessions/:id/draft`, copy controls, and DOCX download through `GET /message-agent/sessions/:id/draft.docx`.
- Extended `apps/web/src/api/client.ts` with message-agent session, upload, chat, draft edit, DOCX download, and delete wrappers using shared `MessageAgent*` types.
- Added compact operations-console styling for the message-agent layout, file/source/template status, follow-up cards, and draft editor.
- Validation passed: `pnpm --filter @harmonia/web typecheck` and `pnpm --filter @harmonia/web build`.

### 2026-06-29 Message Agent Upload Boundary Correction

- Removed image extensions from the reference library/current request upload accept list and changed those controls to explicitly say `可解析文档`.
- Added client-side filtering so only `.xlsx`, `.docx`, `.pdf`, `.md`, `.txt`, and `.csv` enter the pending document upload queue.
- Added clear warnings for selected images, `.msg`, old `.doc`, and other non-parseable files; chat images remain available only through `添加聊天图片`.
- Updated status and source labels to distinguish parseable document states from chat image attachments.

### 2026-06-29 Message Agent Tab Split

- Added top tabs to `/message-agent`: `邮件写作` and `参考邮件库录入`, with `邮件写作` as the default.
- Removed the message-agent `快速` / `精准` mode UI and no longer sends `mode` in message-agent chat requests.
- Kept current request upload, chat, follow-up questions, generated source refs, draft edit/save, DOCX download, and `清空会话` in the `邮件写作` tab.
- Moved reference library upload, reference folder upload, parsed reference source status, warning/unsupported statuses, and template list into `参考邮件库录入`.
- Validation passed: `pnpm --filter @harmonia/web typecheck` and `pnpm --filter @harmonia/web build`.
