# Scholarship Check Backend Agent Requirements

Last updated: 2026-06-17 CST

This document is the backend implementation brief for the independent scholarship/优秀毕业生材料核对 module. Read this before changing `apps/api`, backend-facing `packages/shared` contracts, storage layout, AI adapters, upload handling, or scholarship-check API behavior.

## Product Goal

Build an independent backend module that does not depend on Outlook mail sync. The operator uploads:

- A system-exported original `.xlsx` workbook.
- A folder containing applicant proof materials, organized by applicant and category.

The backend produces a processed `.xlsx` workbook whose `核对情况备注` column is filled for each applicant. This module is for batch review of scholarship/outstanding graduate applications and should be usable even when Graph mail sync is disabled.

## Sample Files And Columns

Reference folder: `ScholarshipCheck/`

Input workbook sample:

- `2026届祥波书院优秀毕业生名单-系统导出原版.xlsx`
- Sheet name: `Export`
- Columns:
  - `序号`
  - `姓名`
  - `性别`
  - `学号`
  - `入学年度`
  - `学院`
  - `宿舍号`
  - `专业`
  - `电话号码`
  - `个人陈述`
  - `书院贡献`
  - `社会服务与实践`
  - `学业表现`
  - `学生组织`
  - `奖项`

Processed workbook sample:

- `2026届祥波书院优秀毕业生名单-申请人信息处理版.xlsx`
- Sheet name: `Sheet1`
- Columns:
  - `序号`
  - `姓名`
  - `性别`
  - `学号`
  - `学院`
  - `专业`
  - `学业表现`
  - `个人陈述`
  - `书院贡献`
  - `学生组织`
  - `社会服务与实践`
  - `奖项`
  - `学院违纪情况`
  - `书院违纪情况`
  - `核对情况备注`
  - `详细情况`

Output should follow the processed workbook column order. For the first version, default `学院违纪情况` and `书院违纪情况` to `无违纪记录` unless a later requirement provides a data source.

## Evidence Folder Shape

The uploaded folder is expected to look like:

```text
祥波书院优秀毕业生附件(证明材料)_2026-03-30/
  张三附件(证明材料)/
    书院贡献/
    学生组织/
    社会服务与实践/
    奖项/
  ANNABEL LEONARDI附件(证明材料)/
    ...
```

Most proof files are PDFs, with possible image files. Match applicants primarily by normalized `姓名` against folder names. Preserve uploaded relative paths in storage because category inference depends on parent folder names.

## Required Remark Format

The `核对情况备注` field must be exactly four lines, in this order:

```text
书院贡献：...
学生组织：...
社会服务与实践：...
奖项：...
```

Each `核对情况备注` line must use one of exactly five fixed business statuses:

- `无问题`
- `未填写`
- `无证明材料`
- `部分材料缺失`
- `部分材料不匹配`

The `详细情况` field must also use the same four-line category order and explain the reason for each status. The row/job `error` fields are reserved for technical failures, not business material-check explanations.

## Backend Scope

Implement the module under a new backend area, for example:

- `apps/api/src/scholarship-check/`
- Route registration in `apps/api/src/app.ts`
- Shared response types in `packages/shared/src/index.ts` only for API contracts.

Do not couple this module to `MailMessage`, `ReplyDraft`, Graph sync, or existing scholarship email processing. Reuse the existing AI client style only where it helps.

## Ownership Boundary

Backend agents must not implement UI work. Do not modify `apps/web`, React pages, CSS, sidebar navigation, browser storage, or button behavior from this brief.

Backend ownership is limited to:

- API routes and validation.
- Job state machine and persistence.
- Upload storage, retention, and deletion.
- Workbook parsing/output.
- AI/multimodal verification.
- Shared TypeScript API contract types needed by both sides.

Frontend behavior is specified only in `docs/scholarship-check-frontend-agent.md`.

### Exclusive Backend Files

Only the backend agent may edit these files for this feature:

- `apps/api/src/scholarship-check/**`
- `apps/api/src/app.ts` route registration for scholarship-check APIs
- `apps/api/src/config/env.ts` backend env parsing for scholarship-check settings
- `apps/api/test/*scholarship*`
- Backend package/dependency files when needed for API processing

`apps/api/src/scholarship-check/service.ts` is explicitly backend-owned. Frontend agents must never edit it.

Shared API contract changes in `packages/shared/src/index.ts` should be made by the backend agent first, then treated as read-only by the frontend agent unless the leader explicitly asks for a frontend-side contract correction.

### Implementation Sequence

Do not run backend and frontend agents against this feature in fully parallel edit mode.

1. Backend agent updates API contracts, service state, persistence, and tests.
2. Backend agent records the final API surface in this document.
3. Frontend agent updates UI and API client against the recorded backend surface.

If both agents are active at once, they must not edit the same file. In particular, frontend work must wait for backend completion before consuming new shared types.

## API Contract

Add authenticated routes. Existing cookie auth should protect these endpoints.

### Create Job

`POST /scholarship-check/jobs`

Multipart form fields:

- `workbook`: required `.xlsx` file.
- `evidenceFiles`: required repeated files.
- `evidencePaths`: required JSON string array. Same order as `evidenceFiles`; each entry is the browser-relative path for the matching file.
- Optional `mode`: `ai` or `dry_run`. Default `ai`.

Response:

```ts
{
  job: {
    id: string;
    status: "queued" | "processing" | "paused" | "completed" | "failed" | "cancelled";
    createdAt: string;
    updatedAt: string;
    totalApplicants: number;
    processedApplicants: number;
    error: string | null;
  }
}
```

### Get Job

`GET /scholarship-check/jobs/:id`

Response:

```ts
{
  job: ScholarshipCheckJob;
  rows: Array<{
    rowNumber: number;
    name: string;
    studentId: string;
    status: "pending" | "processing" | "completed" | "failed" | "cancelled";
    remark: string | null;
    error: string | null;
  }>;
}
```

### Download Result

`GET /scholarship-check/jobs/:id/result`

Returns the processed `.xlsx` file when the job is complete. Return `409` if the job is not complete and `404` for unknown jobs.

### Recent Jobs

`GET /scholarship-check/jobs?limit=5`

Return the five most recent retained scholarship check jobs, newest first. This endpoint is required so an operator can log out, log back in, or navigate away and still recover recent check records.

Response:

```ts
{
  items: ScholarshipCheckJob[];
  total: number;
}
```

Retention rule:

- Keep the latest five jobs persistently across server restarts and user re-login.
- After a sixth job is created, remove or archive older job records and uploaded/result files so only five active history records remain visible and downloadable.
- The record list is global for the admin console unless a later product requirement introduces per-user ownership.

### Update Row Remark

`PATCH /scholarship-check/jobs/:id/rows/:rowNumber`

Allow manual correction of the `核对情况备注` result for one applicant row.

Request:

```ts
{
  remark: string;
  detail: string;
}
```

Rules:

- Validate the remark still follows the required four-line category format.
- Validate each remark line uses one of the five allowed statuses.
- Validate detail follows the same four-line category format.
- Save the edited row persistently.
- Regenerate or mark the result workbook stale and regenerate before the next download.
- Record enough metadata to show that the row was manually edited, for example `editedAt` and `editedBy` if available.

Response:

```ts
{
  row: ScholarshipCheckRow;
  job: ScholarshipCheckJob;
}
```

### Delete Job

`DELETE /scholarship-check/jobs/:id`

Delete one retained record and its stored workbook/evidence/result files.

Rules:

- If the job is `queued`, `processing`, or `paused`, cancel it first.
- Return `{ ok: true }`.
- Unknown jobs return `404`.

### Pause, Resume, And Cancel Job

`POST /scholarship-check/jobs/:id/pause`

Pause a `queued` or `processing` job after the current applicant/model call finishes. Pausing must not corrupt the partial snapshot.

`POST /scholarship-check/jobs/:id/resume`

Resume a paused job from the next unfinished applicant row.

`POST /scholarship-check/jobs/:id/cancel`

Terminate a `queued`, `processing`, or `paused` job. The job should become `cancelled`, unfinished rows should become `cancelled`, and no further AI calls should start.

Responses:

```ts
{
  job: ScholarshipCheckJob;
  rows: ScholarshipCheckRow[];
}
```

Implementation requirements:

- Processing must check control state between applicants and before starting each new model request.
- If a model call is already in flight, pause/cancel should take effect immediately after that call returns unless the selected provider supports aborting safely.
- Cancelled jobs should remain in the recent five records until deleted or pushed out by retention.
- Download behavior for `cancelled` jobs should produce a partial workbook with completed/edited remarks preserved and unfinished rows marked `未核对` or left blank according to product choice. Document the chosen behavior in this file when implemented.

## Award Confidence Workbook Module

This is a separate backend module from the proof-material checker above. It accepts only one `.xlsx` workbook and does not accept or inspect proof-material folders.

Reference folder and workbook:

- `ScholarshipCheck/`
- `附件2：2025年祥波书院奖学金个人奖项申请资料.xlsx`

Observed workbook structure:

- Sheets include `总表` and award-specific sheets such as `①院长嘉许奖`, `②杰出领导力奖`, `③优秀服务奖`, `④卓越体育贡献奖`, and `⑤卓越才艺贡献奖`.
- Only `总表` is used as the input source for award confidence calculation. Award-specific sheets are not parsed, not scored, and should not trigger AI calls.
- Header row is row 1.
- Important normalized columns:
  - `序号`
  - `初审情况`
  - `姓名`
  - `申请奖项 第一奖项`
  - `申请奖项 第二奖项`
  - `个人陈述`
  - `第一位推荐人`
  - `第二位推荐人`
  - `书院活动贡献`
  - `社会服务实践和成就`
  - `宿舍生活服务`
  - `学业表现`
  - `学生组织`
  - `奖项/其他`
  - `核对备注说明`

Header matching must normalize whitespace because the workbook uses wrapped headers such as `申请奖项\r\n第一奖项`.

### Backend Ownership

Backend agents own all parsing, scoring, persistence, output workbook generation, and tests for this module.

Backend agents may add a new backend area such as:

- `apps/api/src/award-confidence/`
- route registration in `apps/api/src/app.ts`
- shared API contract types in `packages/shared/src/index.ts`
- backend tests in `apps/api/test/*awardConfidence*` or equivalent

Backend agents must not implement React UI, sidebar labels, CSS, browser file inputs, or client-side score calculation.

### API Contract

Add authenticated routes under a new API namespace. Suggested route names:

`POST /award-confidence/jobs`

Multipart form fields:

- `workbook`: required `.xlsx` file.

Response:

```ts
{
  job: {
    id: string;
    status: "queued" | "processing" | "paused" | "completed" | "failed" | "cancelled";
    createdAt: string;
    updatedAt: string;
    totalRows: number;
    processedRows: number;
    error: string | null;
  }
}
```

`GET /award-confidence/jobs?limit=5`

Return the five most recent retained award-confidence jobs, newest first. This endpoint is required so the frontend can recover records after logout/login, reload, or route switches.

Response:

```ts
{
  items: AwardConfidenceJob[];
  total: number;
}
```

`GET /award-confidence/jobs/:id`

Response:

```ts
{
  job: AwardConfidenceJob;
  rows: Array<{
    sheetName: string;
    rowNumber: number;
    name: string;
    firstAward: string | null;
    secondAward: string | null;
    firstAwardConfidence: number | null;
    secondAwardConfidence: number | null;
    status: "pending" | "processing" | "completed" | "failed" | "cancelled";
    error: string | null;
  }>;
}
```

`POST /award-confidence/jobs/:id/pause`

Pause a queued or processing job and persist the paused state.

`POST /award-confidence/jobs/:id/resume`

Resume a paused job. Any row left as `processing` should return to `pending` before processing restarts.

`POST /award-confidence/jobs/:id/cancel`

Cancel a queued, processing, or paused job. Preserve completed scores, mark unfinished rows `cancelled`, and generate a partial result workbook.

`DELETE /award-confidence/jobs/:id`

Delete a retained award-confidence record and remove it from the recent-job index. Deleting an in-flight job must prevent the background worker from recreating the snapshot.

`GET /award-confidence/jobs/:id/result`

Return the processed workbook. Return `409` while processing and `404` for unknown jobs.

### Output Workbook

The backend must preserve the original workbook structure as much as practical:

- Keep all original sheets.
- Keep original columns and row order.
- Only append confidence columns to `总表`; award-specific sheets and other sheets are preserved as-is.
- For `总表`, append exactly two new columns at the end:
  - `第一奖项置信度`
  - `第二奖项置信度`
- Values are numeric scores from `0` to `100`, rounded to one decimal place.
- If the corresponding award cell is blank, leave the confidence cell blank.
- Do not add extra explanation columns in the workbook. Internal/debug score components may be returned in logs or tests only if needed, but not as workbook fields unless product explicitly asks later.

### Quantitative Confidence Method

The score measures how strongly the workbook's structured text matches each applied award within the college-scholarship scope. It is not proof-file verification and must not claim to validate external evidence.

Highest scoring principle: only college-related content may contribute to confidence. Count college life, college social/service contribution, dorm/residential service, college activities, college organizations, and sports/arts/talent contributions only when they are tied to college life or college activities. GPA, academic standing, major/discipline competitions, ordinary external awards, school/department awards, recommender completeness, and initial review status must not increase the score. Academic eligibility is assumed to have been checked upstream.

The backend should use an AI text model to judge each material subitem under this college-related scope, then use a fixed formula to calculate the final confidence score.

For each row and each applied award, compute:

```text
confidence = round(100 * clamp(
  sum(AI_field_score[field] * award_profile_weight[field])
  / sum(award_profile_weight[field])
  - AI_risk_penalty,
  0,
  1
), 1)
```

Component definitions:

- `AI_field_score[field]`: an AI-generated `0` to `1` score for how well that field's college-related text matches the applied award.
- The AI must judge these subitems under the college-related scope: `个人陈述`, `书院活动贡献`, `社会服务实践和成就`, `宿舍生活服务`, `学生组织`, sports-specific college fit, and arts/talent-specific college fit.
- `学业表现` must receive `0` and is not weighted in the final formula.
- `奖项/其他` is not directly weighted. It may only inform sports/arts/talent or other field scores when the item is explicitly tied to college life, college service, or college activities.
- `AI_risk_penalty`: an AI-generated `0` to `0.35` penalty for explicit contradictions or negative notes in `核对备注说明`.
- Do not use `初审情况` or recommender completeness as independent scoring factors for this module unless product later asks for eligibility/completeness scoring.
- If an award cell is blank, the corresponding confidence remains blank and no AI call is made for that award.

Award profile weights for AI field scores:

| Award | Personal statement | College contribution | Service practice | Dorm/residential service | Student org/leadership | College sports fit | College arts/talent fit |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `院长嘉许奖` | 0.15 | 0.30 | 0.20 | 0.15 | 0.20 | 0.00 | 0.00 |
| `杰出领导力奖` | 0.10 | 0.20 | 0.10 | 0.10 | 0.50 | 0.00 | 0.00 |
| `优秀服务奖` | 0.10 | 0.20 | 0.40 | 0.25 | 0.05 | 0.00 | 0.00 |
| `卓越体育贡献奖` | 0.10 | 0.20 | 0.05 | 0.05 | 0.10 | 0.50 | 0.00 |
| `卓越才艺贡献奖` | 0.10 | 0.20 | 0.05 | 0.05 | 0.10 | 0.00 | 0.50 |

Dimension-to-column mapping:

- College contribution: `书院活动贡献`
- Service practice: `社会服务实践和成就`
- Dorm/residential service: `宿舍生活服务`
- Student org/leadership: `学生组织`, but only college-related student organizations, leadership, or organizing work.
- College sports fit: sports-related items in `奖项/其他`, `学生组织`, `书院活动贡献`, and `个人陈述`, but only when tied to college teams, college sports activities, college sports culture, or service to college peers. Pure competition rankings or external sports awards do not count.
- College arts/talent fit: arts/talent-related items in `奖项/其他`, `学生组织`, `书院活动贡献`, and `个人陈述`, but only when tied to college activities, college culture, college public events, or service to college peers. Pure talent awards or external performances do not count.

Score interpretation for UI and tests:

- `85-100`: high confidence that workbook text strongly supports the applied award.
- `70-84.9`: medium-high confidence; generally plausible but may need targeted review.
- `50-69.9`: uncertain; material is incomplete, weakly relevant, or has mixed proof markers.
- `<50`: low confidence; likely insufficient or contradicted by notes.

### Backend Tests

Backend implementation must include tests for:

- Parsing wrapped headers such as `申请奖项\r\n第一奖项`.
- Generating exactly two appended columns on `总表` and preserving all original sheets.
- Award-specific sheets are not parsed, not scored, and do not receive confidence columns.
- Blank second award leaves `第二奖项置信度` blank.
- Known negative notes reduce scores.
- AI is called once for each nonblank applied award and returns per-subitem field scores.
- AI subitem scores drive the final weighted formula; high sports fit should favor `卓越体育贡献奖`, high service fit should favor `优秀服务奖`, etc.
- Each supported award type uses the correct profile weights.
- Invalid workbook or missing award columns returns a clear `400` error.
- `GET /award-confidence/jobs?limit=5` lists and retains the latest five records.
- `DELETE /award-confidence/jobs/:id` removes a record from both detail lookup and the recent list.
- Pause/resume/cancel/delete do not recreate deleted in-flight jobs and do not corrupt partial result output.

## Processing Pipeline

1. Save the workbook and evidence files under `storage/scholarship-check/{jobId}/`.
2. Parse the workbook into applicant records.
3. Normalize evidence file paths into:
   - applicant name
   - category folder
   - file name
   - file type
   - local storage path
4. Split applicant text fields into category items. The source fields commonly use numbered lines and semicolon-separated parts.
5. For each applicant and category, produce one fixed business status plus a detail reason:
   - If the field is empty or `无`, remark `未填写`.
   - If declared content exists but no evidence files exist, remark `无证明材料`.
   - If only some declared items are supported, remark `部分材料缺失`.
   - If evidence contradicts declared date, role, issuer, award, organization, or applicant name, remark `部分材料不匹配`.
   - If all required items are supported and no policy issue is found, remark `无问题`.
6. Produce the processed workbook with both `核对情况备注` and `详细情况`.

## AI / Multimodal Requirements

Use a multimodal model for evidence understanding. During testing, use the CUHK local OpenAI-compatible endpoint through environment configuration. Do not hard-code API keys in source or docs.

Required env behavior:

- Read API key from an environment variable such as `OPENAI_VISION_API_KEY` or `SCHOLARSHIP_CHECK_AI_API_KEY`.
- Default compatible endpoint is `https://ai-api.cuhk.edu.cn/v1`.
- Supported local multimodal models are `qwen3-5-397b-a17b` and `gemma-4-31B`.
- `SCHOLARSHIP_CHECK_AI_MODEL` is the startup default. Runtime settings expose `scholarshipCheckAiModel`, so the configuration page can manually select which supported model is used for new material-check and award-confidence calls.

The user-provided key is sensitive. Do not commit it, echo it, log it, or write it into docs/source. It belongs only in local `.env`.

AI should be used after cheap deterministic checks:

- Use file/folder names first to find likely evidence.
- Use declared `有证明` / `无证明` markers first.
- Call AI only on candidate proof files needed to verify an item.

Expected model task:

- Extract applicant name, award/activity/org, role/title, date range, issuer, and whether the file supports a declared item.
- Return strict JSON.
- Include confidence and a short evidence summary.

PDF support is required because the sample folder is mostly PDFs. Implement either:

- PDF page rendering to images before multimodal calls, or
- A DashScope-native file/document path if verified in implementation.

PDF proof files must be reviewed page-by-page in full. Batching may split model requests, but it must not skip pages.

## Job Execution

This can be long-running. Do not keep the browser request open until all model calls finish.

Minimum acceptable implementation:

- `POST /jobs` stores files, creates job metadata, starts background processing, and returns quickly.
- `GET /jobs/:id` exposes progress.
- Completed output is stored on disk.

Use conservative concurrency for AI calls, for example 1 to 3 concurrent calls. Never log raw personal statements, phone numbers, model keys, or full extracted document text.

### Background Continuation And Recovery

Current inspection on 2026-06-17:

- Backend processing already starts independently from the upload request via an async background call, so it is not tied to any polling client.
- Existing snapshots are written to disk under `storage/scholarship-check/{jobId}/job.json`, so individual known job IDs can survive re-login/server restarts.
- Missing gap: there is no persistent recent-job index/list API yet, so clients cannot discover in-progress or completed jobs without already knowing the job ID.

Required follow-up:

- Add a persistent recent-job index under the scholarship-check storage root or an equivalent repository-backed table.
- The index must be updated on job create, status change, pause/resume/cancel, row edit, result regeneration, and delete.
- On API startup, reconcile the index with job snapshots on disk. Any job left as `processing` during a server crash should become `paused` or `failed` with a clear recoverable message; do not silently resume without an explicit implementation decision.
- The recent-job API must expose active and recent jobs after logout/login or client reconnection.

## Validation And Tests

Add backend tests for:

- Workbook column mapping from source format to processed format.
- Remark formatting always produces the four required lines.
- Applicant-to-folder matching handles Chinese and English names.
- Missing evidence produces `无证明材料` or `部分材料缺失`.
- Mismatched evidence produces `部分材料不匹配` and writes the specific cause to `详细情况`.
- Upload route rejects missing workbook, missing evidence path metadata, non-xlsx workbook, and unknown job download.

If model calls cannot be used in tests, create a fake multimodal verifier.

## Acceptance Criteria

- The API accepts the original `.xlsx` plus evidence files and relative paths.
- Backend creates a job and reports progress.
- Backend writes a result `.xlsx` with processed workbook columns.
- Every row has `核对情况备注` filled with the required four-line fixed-status format.
- Every row has `详细情况` filled with the matching four-line reason format.
- Backend keeps the latest five check records persistently across logout/login and server restart.
- Users can list, inspect, download, edit, and delete retained records.
- Users can pause, resume, and cancel long-running checks without corrupting saved progress.
- Disconnecting a polling client does not stop backend processing, and clients can rediscover active/recent jobs through the list API.
- The module works without Outlook mail sync and without mail-related data.
- API keys are environment-only and never committed.
- Existing mail workflow tests remain unaffected.

## Implementation Progress

### 2026-06-16 15:38 CST

- Implemented backend module under `apps/api/src/scholarship-check/`.
- Added authenticated APIs: `POST /scholarship-check/jobs`, `GET /scholarship-check/jobs/:id`, and `GET /scholarship-check/jobs/:id/result`.
- Added multipart upload support with workbook/evidence file validation.
- Jobs save uploaded files and snapshots under `storage/scholarship-check/{jobId}/`.
- Implemented source workbook parsing, processed workbook generation, applicant folder matching, category inference, and four-line remark formatting.
- Added shared job/row response types in `packages/shared`.
- Added backend tests for workbook column mapping, remark formatting, Chinese/English folder matching, upload validation, unknown downloads, successful background processing, and result download.
- Validation passed: `pnpm review`.

### 2026-06-16 17:38 CST

- Added Qwen-compatible multimodal verification for scholarship check jobs.
- Added `SCHOLARSHIP_CHECK_AI_API_KEY`, `SCHOLARSHIP_CHECK_AI_BASE_URL`, `SCHOLARSHIP_CHECK_AI_MODEL`, `SCHOLARSHIP_CHECK_AI_IMAGES_PER_REQUEST`, and `SCHOLARSHIP_CHECK_AI_PDF_IMAGE_WIDTH`.
- Historical note: this first implementation used `qwen3.7-plus` on the DashScope OpenAI-compatible endpoint. Current configuration is superseded by the CUHK local endpoint and settings-level model selector recorded below.
- PDF proof files are rendered page-by-page into images and every page is submitted across model batches.
- Image proof files are sent directly as image data URLs.
- Added tests for full PDF page rendering and for default AI-mode verifier invocation with a fake multimodal client.
- Validation passed: `pnpm --filter @harmonia/api typecheck` and `pnpm --filter @harmonia/api test`.

### 2026-06-16 Review Fix

- Restored full PDF page rendering for scholarship proof materials; every page is submitted for review.
- Replaced scholarship backend tests that depended on local `ScholarshipCheck/` applicant materials with generated sanitized workbook/PDF fixtures.
- Added `.gitignore` coverage for local `ScholarshipCheck/` private sample materials.

### 2026-06-17 Follow-Up Requirements

- New product requirements: keep the latest five scholarship check records, allow manual inspect/edit/delete/download through backend APIs, persist records across re-login, add pause/resume/cancel job controls, and preserve background processing when clients disconnect.
- Backend already continues processing independently of client polling, but it lacks the recent-job discovery API needed for clients to recover jobs after reconnecting.
- Required backend additions: persistent recent-job index, `GET /scholarship-check/jobs?limit=5`, row remark edit endpoint, delete endpoint, pause/resume/cancel endpoints, retention cleanup, partial-result behavior for cancelled jobs, and tests for all new state transitions.

### 2026-06-17 Backend Follow-Up Implementation

- Added persistent `index.json` management under `storage/scholarship-check/` and reconciled indexed jobs with on-disk snapshots at service startup.
- Added authenticated backend APIs: `GET /scholarship-check/jobs?limit=5`, `PATCH /scholarship-check/jobs/:id/rows/:rowNumber`, `DELETE /scholarship-check/jobs/:id`, `POST /scholarship-check/jobs/:id/pause`, `POST /scholarship-check/jobs/:id/resume`, and `POST /scholarship-check/jobs/:id/cancel`.
- Startup recovery marks previously `queued` or `processing` snapshots as `paused` with a recoverable restart message instead of silently resuming them.
- Retention now keeps the latest five terminal scholarship check records while preserving active records until they finish or are explicitly deleted.
- Pause and cancel checks run between applicants and before every model request; in-flight model calls are allowed to return before the next state transition is persisted.
- Cancelled jobs remain discoverable in recent records and can download a partial workbook. Completed or manually edited remarks are preserved; unfinished rows are written with four `未核对` remark lines.
- Row edits validate the required four-line category format, persist `editedAt`/`editedBy`, and regenerate downloadable results for terminal jobs.
- Added backend tests for recent-job listing and retention, row remark editing, pause/resume, cancel, and partial workbook download.
- Validation passed: `pnpm --filter @harmonia/api typecheck` and `pnpm --filter @harmonia/api test`.

### 2026-06-17 Award Confidence Backend Implementation

- Implemented the separate workbook-only award-confidence backend module under `apps/api/src/award-confidence/`.
- Added authenticated APIs: `POST /award-confidence/jobs`, `GET /award-confidence/jobs/:id`, and `GET /award-confidence/jobs/:id/result`.
- Added shared `AwardConfidenceJob` and `AwardConfidenceRow` API contract types in `packages/shared`.
- Jobs save uploaded workbooks under `storage/award-confidence/{jobId}/`, parse sheets with wrapped award headers, process rows asynchronously, and write a result workbook to disk.
- Result workbooks preserve original sheets and row order; only `总表` receives exactly `第一奖项置信度` and `第二奖项置信度` appended at the end.
- Implemented AI-backed confidence scoring from workbook text only: the AI judges each material subitem against the applied award, and the backend applies fixed award-profile weights plus AI risk penalty.
- Blank award cells produce blank confidence cells in the output workbook.
- Added backend tests for wrapped headers, preserving sheets, exactly two appended columns, blank second-award output, negative-note penalty, proof/no-proof score direction, award profile weights, and invalid upload handling.
- During full validation, fixed background-job test isolation by placing auto-generated test storage roots in the OS temp directory when no explicit root is injected.
- During full validation, fixed a scholarship-check pause/resume race so a resume request received before the previous worker exits is queued and restarted after the active worker finishes.
- Validation passed: `pnpm --filter @harmonia/api typecheck`, `pnpm --filter @harmonia/api test`, and `pnpm review`.

### 2026-06-17 Award Confidence Lifecycle Controls

- Added backend lifecycle APIs for award-confidence jobs: `POST /award-confidence/jobs/:id/pause`, `POST /award-confidence/jobs/:id/resume`, `POST /award-confidence/jobs/:id/cancel`, and `DELETE /award-confidence/jobs/:id`.
- Extended award-confidence job statuses to include `paused` and `cancelled`, and row statuses to include `cancelled`.
- Processing now checks control state between rows and before starting each new AI scoring request; in-flight model calls are allowed to return before pause/cancel is finalized.
- Cancelled award-confidence jobs generate a partial result workbook with completed scores preserved and unfinished score cells left blank.
- Deleting an in-flight award-confidence job removes its stored files and prevents the background worker from recreating the deleted snapshot.

### 2026-06-17 Award Confidence College-Scope Formula Update

- Updated the award-confidence scoring principle so only college-related content contributes to confidence: college life, social/service contribution, dorm/residential service, college activities, college organizations, and college-scoped sports/arts/talent contribution.
- Removed `学业表现` and generic `奖项/其他` from direct formula weights because GPA/academic eligibility and ordinary awards are upstream or out of scope.
- Updated the AI scoring prompt to ignore GPA, academic standing, ordinary external awards, school/department awards, pure competition rankings, recommender completeness, and initial review status.
- Added backend tests proving academic and generic award scores do not change the final confidence value.

### 2026-06-17 Award Confidence History Records

- Added persistent `index.json` management under `storage/award-confidence/` for the award-confidence module.
- Added authenticated `GET /award-confidence/jobs?limit=5` so clients can list the latest retained confidence records after logout/login, reload, or route switches.
- Award-confidence records now follow the same retention expectation as material checks: keep the latest five terminal records while preserving active records until they finish or are explicitly deleted.
- Deleting an award-confidence record removes its stored job directory and removes the job ID from the recent-record index.
- Startup recovery reconciles indexed jobs with on-disk snapshots and marks previously `queued` or `processing` records as `paused` with a recoverable restart message.
- Added backend tests for award-confidence recent-job retention and deletion from the recent list.

### 2026-06-25 Structured Material Check Output

- Split material-check business output into fixed-status `核对情况备注` and reason-bearing `详细情况`.
- Kept row/job `error` fields for technical failures only; business explanations now live in `detail`.
- Updated processed workbook generation to include both `核对情况备注` and `详细情况`.
- Updated manual row edit API to require both `remark` and `detail`, with four-line category validation.
- Added backend tests for fixed statuses, AI mismatch/missing mappings, four-line detail output, workbook columns, and edited download regeneration.

### 2026-06-25 CUHK Local Model Configuration

- Switched the current default OpenAI-compatible endpoint to `https://ai-api.cuhk.edu.cn/v1`.
- Updated the default selected multimodal model to `qwen3-5-397b-a17b`; `gemma-4-31B` is available as the alternate supported model.
- Added `scholarshipCheckAiModel` to persisted app settings and `scholarship_check_ai_model` to SQLite/Postgres settings storage.
- Material-check and award-confidence AI calls now read the selected settings model at request time, so saving the configuration affects subsequent jobs without restarting the API.

### 2026-06-25 Lenient Material Evidence Review

- Adjusted material-check AI prompting to use a lenient evidence-existence standard: applicant identity, core award/project name, and year/academic year are the primary matching signals.
- Minor differences no longer create business mismatches: exact day missing, month/year or academic-year-only dates, abbreviations, Chinese/English translations, same entity under different names, near-synonym roles, slight typos, screenshots, photos, or informal proof format.
- Backend aggregation now filters minor `issues` from model output. Minor issues are preserved in `详细情况`, but `核对情况备注` can remain `无问题` when core evidence matches.
- True hard conflicts still produce `部分材料不匹配`: different applicant, completely different award/project, clear year/academic-year conflict, clear award level/ranking conflict, or proof pointing to a different experience.
