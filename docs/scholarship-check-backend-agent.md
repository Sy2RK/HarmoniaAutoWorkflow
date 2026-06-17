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

Use concise reviewer-facing Chinese. Existing examples include:

- `无问题`
- `未填写`
- `无证明材料`
- `部分条目无证明材料`
- `大学参与内容无法确认`
- `学院参与内容无法确认`
- `学助工作已有薪资，不算做书院贡献`
- `活动参与者不算做书院贡献`
- Specific mismatch notes, for example `学生大使担任的时间与证明材料不一致`

The implementation may return richer structured details internally, but the workbook cell should keep this compact four-line format.

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
}
```

Rules:

- Validate the remark still follows the required four-line category format.
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
    status: "queued" | "processing" | "completed" | "failed";
    createdAt: string;
    updatedAt: string;
    totalRows: number;
    processedRows: number;
    error: string | null;
  }
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
    status: "pending" | "processing" | "completed" | "failed";
    error: string | null;
  }>;
}
```

`GET /award-confidence/jobs/:id/result`

Return the processed workbook. Return `409` while processing and `404` for unknown jobs.

### Output Workbook

The backend must preserve the original workbook structure as much as practical:

- Keep all original sheets.
- Keep original columns and row order.
- For every sheet whose normalized header contains the two award columns, append exactly two new columns at the end:
  - `第一奖项置信度`
  - `第二奖项置信度`
- Values are numeric scores from `0` to `100`, rounded to one decimal place.
- If the corresponding award cell is blank, leave the confidence cell blank.
- Do not add extra explanation columns in the workbook. Internal/debug score components may be returned in logs or tests only if needed, but not as workbook fields unless product explicitly asks later.

### Quantitative Confidence Method

The score measures how strongly the workbook's structured text supports each applied award. It is not proof-file verification and must not claim to validate external evidence. The first version should be deterministic and reproducible without a multimodal model.

For each row and each applied award, compute:

```text
confidence = round(100 * clamp(
  0.10 * B_status
+ 0.35 * D_award_support
+ 0.20 * Q_proof_reliability
+ 0.15 * T_text_relevance
+ 0.10 * M_recommender_support
+ 0.10 * G_academic_baseline
- P_risk_penalty,
0, 1), 1)
```

Component definitions:

- `B_status`: weak prior from `初审情况`.
  - `入围` = `1.00`
  - `未入围` = `0.35`
  - blank/other = `0.60`
- `D_award_support`: award-specific weighted support from relevant workbook fields. For each evidence dimension, parse numbered items and semicolon-delimited records. Use item count, point totals, and proof flags where available.
  - Dimension score: `0.50 * min(pointsWithProof / targetPoints, 1) + 0.30 * proofItemRatio + 0.20 * min(itemCount / targetItems, 1)`
  - If no explicit point values exist, use item count and proof ratio only.
  - Default `targetItems = 3`; default `targetPoints = 10` unless a later rubric provides official thresholds.
- `Q_proof_reliability`: reliability of declared support inside relevant fields.
  - Count `有证明`, `无证明`, and equivalent English/Chinese terms.
  - `Q = provenItems / declaredItems`; blank declared fields score `0`.
  - Items marked `无证明` reduce this score even if the narrative is strong.
- `T_text_relevance`: deterministic relevance between award profile and row text.
  - Use normalized keyword coverage across `个人陈述`, relevant activity fields, `学生组织`, and `奖项/其他`.
  - Maintain bilingual keyword dictionaries for sports, arts/talent, leadership, service, residential/community contribution, and academic excellence.
  - Score `min(uniqueMatchedKeywordFamilies / requiredKeywordFamilies, 1)`, with required families per award profile.
- `M_recommender_support`: recommendation completeness.
  - two recommenders with identifiable contact text = `1.00`
  - one recommender with identifiable contact text = `0.70`
  - recommender text without contact cue = `0.40`
  - no recommender = `0`
- `G_academic_baseline`: parse GPA values from `学业表现`.
  - Use the mean of numeric GPA values in the row.
  - `G = clamp((meanGpa - 2.0) / 2.0, 0, 1)` for a 4.0 scale.
  - If no GPA is parseable, use `0.50` instead of `0` to avoid over-penalizing non-academic awards.
- `P_risk_penalty`: penalty from `核对备注说明` and negative evidence markers.
  - Severe markers: `无效`, `无法证明`, `非本人`, `未体现学生姓名`, `非参赛人`, `非书院活动`.
  - Moderate markers: `无证明`, `无法查证`, `不清晰`, `重复`, `报名表`, `照片`, `标红`.
  - `P = min(0.35, 0.08 * severeCount + 0.04 * moderateCount)`.

Award profile weights for `D_award_support`:

| Award | College contribution | Service practice | Dorm/residential service | Academic | Student org/leadership | Awards/general | Sports | Arts/talent |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `院长嘉许奖` | 0.20 | 0.20 | 0.10 | 0.25 | 0.15 | 0.10 | 0.00 | 0.00 |
| `杰出领导力奖` | 0.20 | 0.15 | 0.10 | 0.00 | 0.40 | 0.15 | 0.00 | 0.00 |
| `优秀服务奖` | 0.25 | 0.35 | 0.25 | 0.00 | 0.10 | 0.05 | 0.00 | 0.00 |
| `卓越体育贡献奖` | 0.15 | 0.05 | 0.00 | 0.05 | 0.20 | 0.05 | 0.50 | 0.00 |
| `卓越才艺贡献奖` | 0.15 | 0.05 | 0.00 | 0.05 | 0.20 | 0.05 | 0.00 | 0.50 |

Dimension-to-column mapping:

- College contribution: `书院活动贡献`
- Service practice: `社会服务实践和成就`
- Dorm/residential service: `宿舍生活服务`
- Academic: `学业表现`
- Student org/leadership: `学生组织`
- Awards/general: `奖项/其他`
- Sports: sports-related items in `奖项/其他`, `学生组织`, `书院活动贡献`, and `个人陈述`
- Arts/talent: arts/talent-related items in `奖项/其他`, `学生组织`, `书院活动贡献`, and `个人陈述`

Score interpretation for UI and tests:

- `85-100`: high confidence that workbook text strongly supports the applied award.
- `70-84.9`: medium-high confidence; generally plausible but may need targeted review.
- `50-69.9`: uncertain; material is incomplete, weakly relevant, or has mixed proof markers.
- `<50`: low confidence; likely insufficient or contradicted by notes.

### Backend Tests

Backend implementation must include tests for:

- Parsing wrapped headers such as `申请奖项\r\n第一奖项`.
- Generating exactly two appended columns and preserving all original sheets.
- Blank second award leaves `第二奖项置信度` blank.
- Known negative notes reduce scores.
- `有证明` versus `无证明` changes confidence in the expected direction.
- Each supported award type uses the correct profile weights.
- Invalid workbook or missing award columns returns a clear `400` error.

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
5. For each applicant and category:
   - If the field is empty or `无`, remark `未填写`.
   - If all declared items say `无证明` and no evidence files exist, remark `无证明材料`.
   - If only some declared items lack support, remark `部分条目无证明材料`.
   - If all required items are supported and no policy issue is found, remark `无问题`.
   - If evidence contradicts declared date, role, issuer, award, organization, or applicant name, produce a specific mismatch note.
6. Produce the processed workbook with the required columns and remark field.

## AI / Multimodal Requirements

Use a multimodal model for evidence understanding. During testing, use Alibaba Qwen 3.7 Plus through environment configuration. Do not hard-code API keys.

Required env behavior:

- Read API key from an environment variable such as `OPENAI_VISION_API_KEY` or a new `SCHOLARSHIP_CHECK_AI_API_KEY`.
- Default compatible endpoint may use `https://dashscope.aliyuncs.com/compatible-mode/v1`.
- Default model may use `qwen3.7-plus`.

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
- Missing evidence produces `无证明材料` or `部分条目无证明材料`.
- Upload route rejects missing workbook, missing evidence path metadata, non-xlsx workbook, and unknown job download.

If model calls cannot be used in tests, create a fake multimodal verifier.

## Acceptance Criteria

- The API accepts the original `.xlsx` plus evidence files and relative paths.
- Backend creates a job and reports progress.
- Backend writes a result `.xlsx` with processed workbook columns.
- Every row has `核对情况备注` filled with the required four-line format.
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
- Scholarship check AI defaults to `qwen3.7-plus` on the DashScope OpenAI-compatible endpoint and is independent from the mail workflow `AI_ENABLED` flag.
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
