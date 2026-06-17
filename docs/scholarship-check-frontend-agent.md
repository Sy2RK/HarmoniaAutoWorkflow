# Scholarship Check Frontend Agent Requirements

Last updated: 2026-06-17 CST

This document is the frontend implementation brief for the independent scholarship/优秀毕业生材料核对 module. Read this before changing `apps/web`, `packages/shared`, navigation, upload behavior, or API client code.

## Product Goal

Add a standalone UI for batch scholarship/outstanding graduate material checking. This page must not depend on Outlook mail sync. The operator uploads:

- `系统导出原版.xlsx`
- A proof-material folder containing applicant subfolders and PDF/image proof files.

The UI starts a backend job, shows progress, previews per-applicant remarks, and lets the operator download the processed workbook whose `核对情况备注` column has been filled.

## Route And Navigation

Add a protected route:

- `/scholarship-check`

Add a sidebar navigation item:

- Label: `奖学金核对`
- Use an appropriate `lucide-react` icon, for example `FileCheck2`, `GraduationCap`, or `ClipboardCheck`.

Keep the page visually consistent with the current operations-console style in `apps/web/src/styles/app.css`: compact panels, restrained colors, table-first layout, no landing-page treatment.

## Ownership Boundary

Frontend agents must not implement backend job state, API routes, storage retention, AI verification, or workbook generation from this brief. Do not modify `apps/api` for this feature.

Frontend ownership is limited to:

- Route/page/component/UI implementation in `apps/web`.
- API client methods that call backend routes.
- Client-side upload packaging with `FormData`.
- Progress, history, editing, lifecycle-control UI, and download handling.
- Shared TypeScript API contract imports from `packages/shared`.

Backend behavior is specified only in `docs/scholarship-check-backend-agent.md`.

### Forbidden Frontend Files

Frontend agents must not edit these backend-owned files:

- `apps/api/src/scholarship-check/**`
- `apps/api/src/app.ts`
- `apps/api/src/config/env.ts`
- `apps/api/test/*scholarship*`
- Backend package/dependency files for API processing

`apps/api/src/scholarship-check/service.ts` is explicitly off-limits for frontend agents.

Shared contract rule:

- Do not add or reshape `packages/shared/src/index.ts` types while backend work is still in progress.
- After backend finishes, frontend may import existing shared types.
- If a shared type is missing or wrong, stop and report the required backend contract change instead of editing backend-owned logic.

### Implementation Sequence

Frontend implementation should start after backend contract work is complete. The frontend agent should use the final API surface recorded in `docs/scholarship-check-backend-agent.md` and avoid speculative backend edits.

## Page Workflow

Create a page such as:

- `apps/web/src/pages/ScholarshipCheckPage.tsx`

Main states:

1. **Input**
   - Select original `.xlsx` workbook.
   - Select proof-material folder.
   - Show selected workbook name.
   - Show number of proof files selected.
   - Show a small breakdown by top-level applicant folder if easy to compute client-side.
2. **Start**
   - Button: `开始核对`
   - Disabled until both workbook and at least one proof file are selected.
3. **Processing**
   - Show backend job status.
   - Show `processedApplicants / totalApplicants`.
   - Poll `GET /scholarship-check/jobs/:id` every 2 to 5 seconds while queued/processing.
4. **Review**
   - Table columns:
     - `姓名`
     - `学号`
     - `状态`
     - `核对情况备注`
     - `错误`
   - Preserve line breaks in `核对情况备注`.
5. **Download**
   - Button: `下载处理版 Excel`
   - Enabled only when job status is `completed`.

## File Upload Requirements

Folder upload should use browser directory selection:

```tsx
<input type="file" multiple webkitdirectory="true" />
```

React/TypeScript may require a local type extension or prop cast because `webkitdirectory` is non-standard.

When sending files to the backend:

- Append the workbook as `workbook`.
- Append each proof file as `evidenceFiles`.
- Send an `evidencePaths` JSON array in the same order as `evidenceFiles`.
- Each path should use `file.webkitRelativePath || file.name`.

This is important because backend category and applicant matching rely on folder names such as:

```text
祥波书院优秀毕业生附件(证明材料)_2026-03-30/张三附件(证明材料)/奖项/xxx.pdf
```

If a browser does not support folder upload, show a clear message that this module currently requires folder selection. A later version may add zip upload; do not invent zip support unless the backend contract includes it.

## API Client Contract

Add client methods in `apps/web/src/api/client.ts`.

Types can live in `packages/shared/src/index.ts` if shared with backend:

```ts
export type ScholarshipCheckJobStatus = "queued" | "processing" | "paused" | "completed" | "failed" | "cancelled";

export type ScholarshipCheckJob = {
  id: string;
  status: ScholarshipCheckJobStatus;
  createdAt: string;
  updatedAt: string;
  totalApplicants: number;
  processedApplicants: number;
  error: string | null;
};

export type ScholarshipCheckRow = {
  rowNumber: number;
  name: string;
  studentId: string;
  status: "pending" | "processing" | "completed" | "failed" | "cancelled";
  remark: string | null;
  error: string | null;
};
```

Expected methods:

- `createScholarshipCheckJob(workbook: File, evidenceFiles: File[])`
- `scholarshipCheckJobs(limit?: number)`
- `scholarshipCheckJob(id: string)`
- `downloadScholarshipCheckResult(id: string)`
- `updateScholarshipCheckRow(jobId: string, rowNumber: number, remark: string)`
- `deleteScholarshipCheckJob(id: string)`
- `pauseScholarshipCheckJob(id: string)`
- `resumeScholarshipCheckJob(id: string)`
- `cancelScholarshipCheckJob(id: string)`

For multipart upload, do not force the global JSON `Content-Type`; let the browser set the multipart boundary. This likely requires either a separate request helper or special handling in the existing `request<T>()`.

For download, use `response.blob()` and trigger a browser download with a sensible filename, for example:

```text
申请人信息处理版-核对结果.xlsx
```

## Award Confidence Workbook Module UI

This is a separate frontend workflow from the proof-material checker. It accepts only one `.xlsx` workbook and must not ask the operator to select a proof-material folder.

Reference workbook for UI copy and preview expectations:

- `ScholarshipCheck/附件2：2025年祥波书院奖学金个人奖项申请资料.xlsx`

The backend scoring and workbook generation contract is defined only in `docs/scholarship-check-backend-agent.md`.

### Frontend Ownership

Frontend agents own:

- Page/section UI for the single-workbook confidence workflow.
- Browser file selection for one `.xlsx`.
- API client methods that call backend award-confidence routes after backend contract is implemented.
- Display of backend job status, preview rows, confidence values, and download action.
- User-facing validation such as "请选择 xlsx 文件" before upload.

Frontend agents must not:

- Implement or duplicate the confidence scoring formula.
- Parse workbook contents to compute confidence.
- Add backend routes, storage, tests, or scoring utilities.
- Modify `apps/api/src/**` for this workflow.
- Add extra output workbook columns beyond the two backend-defined confidence fields.

### Suggested UI Placement

Add this workflow as either:

- a tab/segmented control inside the existing `/scholarship-check` page, or
- a sibling protected page if product later asks for a separate route.

Recommended labels if placed inside the existing page:

- Existing proof-material workflow tab: `材料核对`
- New workbook-only workflow tab: `奖项置信度`

The initial screen for the new tab should be the actual upload tool, not a landing page.

### User Workflow

1. Select one `.xlsx` workbook.
2. Click `计算置信度`.
3. Frontend uploads the workbook to the backend.
4. Frontend shows job state and row preview returned by backend.
5. Frontend enables `下载置信度 Excel` when backend job is complete.

No folder upload, evidence file count, pause/resume/cancel controls, or row remark editing is required for this module unless backend later exposes those capabilities.

### API Client Contract

After backend implements the contract, add client methods matching the backend API:

- `createAwardConfidenceJob(workbook: File)`
- `awardConfidenceJob(id: string)`
- `downloadAwardConfidenceResult(id: string)`

Expected upload behavior:

- Use `FormData`.
- Append the workbook as `workbook`.
- Do not set a manual `Content-Type`; let the browser set the multipart boundary.
- Reject non-`.xlsx` files client-side before upload.

Expected response shapes:

```ts
export type AwardConfidenceJobStatus = "queued" | "processing" | "completed" | "failed";

export type AwardConfidenceJob = {
  id: string;
  status: AwardConfidenceJobStatus;
  createdAt: string;
  updatedAt: string;
  totalRows: number;
  processedRows: number;
  error: string | null;
};

export type AwardConfidenceRow = {
  sheetName: string;
  rowNumber: number;
  name: string;
  firstAward: string | null;
  secondAward: string | null;
  firstAwardConfidence: number | null;
  secondAwardConfidence: number | null;
  status: "pending" | "processing" | "completed" | "failed";
  error: string | null;
};
```

If shared types are missing, stop and report the required backend/shared contract update. Do not create backend logic from the frontend task.

### Preview Table

Show a compact table with these columns:

- `Sheet`
- `姓名`
- `第一奖项`
- `第一奖项置信度`
- `第二奖项`
- `第二奖项置信度`
- `状态`
- `错误`

Confidence display rules:

- Backend sends numeric scores from `0` to `100`.
- Render with one decimal place, for example `86.5`.
- Blank/null score should display `-`.
- Use restrained badges or text colors only for readability:
  - `>=85`: high confidence
  - `70-84.9`: medium-high
  - `50-69.9`: uncertain
  - `<50`: low confidence
- Do not explain the scoring formula in visible in-app text; the formula belongs in backend documentation and reviewer documentation, not the operational UI.

### Download

When job status is `completed`, enable a download button.

Suggested filename:

```text
奖项置信度结果.xlsx
```

The downloaded workbook must be the backend-generated workbook preserving original sheets and adding only:

- `第一奖项置信度`
- `第二奖项置信度`

## UX Details

- Keep actions explicit because the job may call a paid multimodal model.
- Do not display or ask for the model API key in the frontend.
- Surface backend errors in a readable notice.
- Keep selected file/folder state after a failed upload so the operator can retry.
- Prevent duplicate submission while a job is being created.
- If a job fails, keep the preview rows that are available and show the job-level error.

Suggested UI copy:

- Page title: `奖学金材料核对`
- Meta: `上传申请表与证明材料，生成核对备注`
- Workbook label: `系统导出原版 Excel`
- Folder label: `证明材料文件夹`
- Primary action: `开始核对`
- Progress label: `已处理 X / Y`

## Recent Records, Editing, And Lifecycle Controls

Add a recent-records area on `/scholarship-check`.

Required behavior:

- Load `GET /scholarship-check/jobs?limit=5` when the page mounts.
- Show the latest five records, newest first.
- Each record should show created time, updated time, status, processed/total count, and a short error if present.
- Selecting a record loads `GET /scholarship-check/jobs/:id` and displays the row preview.
- Completed, failed, paused, and cancelled records remain visible until deleted or pushed out by backend retention.
- The user can download Excel for retained records whenever backend allows it.
- The user can delete a record with a confirmation step.

Manual edit requirements:

- Add an edit affordance for each applicant row's `核对情况备注`.
- Editing should preserve the four-line remark structure.
- Save through `PATCH /scholarship-check/jobs/:id/rows/:rowNumber`.
- After save, update the row preview and make the next download use the edited workbook.
- Show clear feedback such as `备注已保存`.

Pause/resume/cancel controls:

- For `queued` or `processing` jobs, show `暂停` and `终止`.
- For `paused` jobs, show `继续` and `终止`.
- Hide or disable lifecycle buttons for `completed`, `failed`, and `cancelled` jobs.
- `终止` must require confirmation because the job may have already spent model calls.
- Continue polling while a selected job is `queued` or `processing`.
- Stop polling selected jobs when they become `paused`, `completed`, `failed`, or `cancelled`, but allow manual refresh.

Route-switch/background behavior:

- Current inspection on 2026-06-17: backend jobs already continue after the page unmounts, but the frontend keeps the selected job only in component state.
- Required frontend behavior: when returning to `/scholarship-check`, reload recent records and automatically select the newest active job (`queued`, `processing`, or `paused`) if there is one.
- Store the last selected job ID in `localStorage` as a convenience, but do not depend on it as the only recovery path; the backend recent-job API is the source of truth.
- Switching to another feature page must not send any cancel/pause request implicitly.

## Remark Display

The backend remark uses four lines:

```text
书院贡献：...
学生组织：...
社会服务与实践：...
奖项：...
```

Render the cell with `white-space: pre-wrap` so the line structure is visible. Do not collapse it into one line.

## Acceptance Criteria

- A logged-in user can open `/scholarship-check`.
- The sidebar exposes `奖学金核对`.
- The user can select one `.xlsx` workbook and a proof-material folder.
- The frontend sends both files and relative paths to the backend.
- The page shows job progress and per-applicant rows.
- The download button appears/enables only after completion.
- The downloaded file is the backend-generated `.xlsx`.
- The page lists the five latest persisted check records after login.
- The user can select an old record, inspect rows, edit remarks, download Excel, and delete the record.
- The user can pause, resume, and cancel active checks through explicit buttons.
- Leaving `/scholarship-check` for another page does not pause or cancel the backend job.
- Returning to `/scholarship-check` rediscovers active/recent jobs and resumes polling active jobs.
- No API key is present in frontend code, UI state, network payloads, or logs.

## Implementation Progress

### 2026-06-17 Follow-Up Requirements

- New product requirements: recent five persistent records, manual inspect/edit/delete/download, pause/resume/cancel, and route-switch-safe background processing.
- Current frontend gap: active job state is held in `ScholarshipCheckPage` component state only, so leaving and returning to the page loses the selected job unless the user still has the ID elsewhere.
- Required frontend additions: recent-records list, automatic active-job recovery, lifecycle buttons, row remark editor, delete confirmation, localStorage last-selection convenience, and updated status labels for `paused` and `cancelled`.

### 2026-06-17 Frontend Follow-Up Implementation

- Implemented the recent-records area on `/scholarship-check`, loading `GET /scholarship-check/jobs?limit=5` and showing created time, updated time, status, processed count, and short job errors.
- Added record selection, latest active/paused job recovery on route return, `localStorage` last-selected-job convenience, and manual refresh.
- Added pause/resume/cancel controls with cancellation confirmation, delete confirmation, terminal-record download attempts, and row-level remark editing through `PATCH /scholarship-check/jobs/:id/rows/:rowNumber`.
- Updated frontend API client methods and page CSS for the new lifecycle, history, and editing interactions.
- Validation note: direct `pnpm`/`node` frontend validation could not run because this shell does not expose Node.js, Corepack, or pnpm on PATH.
