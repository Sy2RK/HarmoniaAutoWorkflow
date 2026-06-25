# College Knowledge Q&A Frontend Agent Requirements

Last updated: 2026-06-25 CST

This document is the frontend-only implementation brief for the new `书院知识问答` module. Frontend agents must read this before touching the college knowledge UI, navigation, API client calls, or settings-page cleanup.

## Product Goal

Build an independent sidebar module named `书院知识问答`.

The module has two tabs:

- `知识问答`: chat-style AI Q&A over uploaded college documents.
- `知识文档录入`: upload and manage source documents used by the Q&A system.

The old settings-page manual knowledge entry UI must be removed:

- Remove the `新增知识库` panel from `apps/web/src/pages/SettingsPage.tsx`.
- Remove the `知识库条目` panel from `apps/web/src/pages/SettingsPage.tsx`.
- Stop loading `api.knowledge()` inside the settings page only for displaying those two panels.
- Do not remove backend legacy `knowledge_entries` code from frontend work unless the leader explicitly asks for a legacy-mail-flow migration.

## Ownership Boundary

Frontend agents own:

- `apps/web/src/pages/CollegeKnowledgePage.tsx` or equivalent new page.
- Sidebar navigation in `apps/web/src/components/Layout.tsx`.
- Route registration and keep-alive behavior in `apps/web/src/App.tsx`.
- API client methods in `apps/web/src/api/client.ts`.
- Shared type consumption after the backend agent records the final API contract.
- UI styling in `apps/web/src/styles/app.css`.
- Removal of old settings-page knowledge entry panels.

Frontend agents must not:

- Implement document parsing, Markdown conversion, chunking, retrieval, reranking, or answer generation.
- Calculate search relevance in the browser.
- Store the source knowledge base in browser localStorage.
- Add backend routes, backend service files, database tables, or parser dependencies.
- Modify backend-owned files under `apps/api` for this feature.

Backend behavior is specified only in `docs/college-knowledge-backend-agent.md`.

## Navigation And Routing

Add a sidebar item:

- Label: `书院知识问答`
- Route: `/college-knowledge`
- Suggested icon: `BookOpenText`, `MessagesSquare`, or another existing `lucide-react` knowledge/chat icon.

Add the new route to the protected keep-alive page list in `apps/web/src/App.tsx`, because users may switch away while a chat draft, upload progress view, or document list is open.

Do not bury this feature under settings. It is a first-class module.

## Page Layout

Create a dense operations-console page with a compact header and segmented tabs.

Tabs:

- `知识问答`
- `知识文档录入`

The first screen should be the usable experience, not a landing page.

## Knowledge Q&A Tab

### Required UI

Implement a chat interface:

- Message list with user and assistant turns.
- Bottom composer with multiline text input.
- Optional image attachment input.
- Send button with icon.
- Loading state while the assistant is answering.
- Error notice for failed requests.
- Empty state with a concise placeholder, not instructional marketing copy.

### Image Upload

The Q&A composer must allow one or more image files if the backend contract supports it. The frontend only uploads the images; it must not run OCR or image analysis locally.

Images should be sent as multipart form data if the backend chooses that route. If the backend instead exposes JSON with base64 image payloads, follow the backend contract exactly.

### Source Display

Every assistant answer that used retrieved knowledge must display source references returned by the backend.

Each source card/chip should show:

- File name.
- Source locator, for example `第 2 页`, `Sheet1 第 18 行`, `第 4 张幻灯片`, or heading name.
- Optional snippet when returned by backend.
- Optional score/relevance only if the backend exposes it for debugging; hide by default if it clutters the UI.

Sources must be clearly associated with the answer turn that used them.

If the backend returns `answerable: false`, show the answer and sources normally if present; do not invent a source.

### Chat State

Keep chat state page-local for the first implementation unless the backend adds session persistence.

If backend exposes sessions:

- Load recent sessions only after the backend contract is final.
- Do not build session persistence in localStorage as a replacement for backend state.

## Document Ingestion Tab

### Required Upload Inputs

Support:

- Multiple file upload.
- Folder upload from browser when available via `webkitdirectory`.
- Zip upload if accepted by backend.

The frontend must preserve browser-provided relative paths when uploading a folder. Include a parallel field such as `relativePaths` only if the backend specifies it.

Supported user-facing formats:

- `.docx`
- `.doc`
- `.pptx`
- `.ppt`
- `.xlsx`
- `.xls`
- `.pdf`
- `.md`
- `.txt`
- `.csv`
- Optional `.html` if backend supports it.

The frontend should accept the files and let the backend decide parser support. For old `.doc` and `.ppt`, display backend status such as `需要文档转换器` instead of blocking in the browser.

### Document List

Show an admin document list with:

- File name.
- Relative path.
- File type.
- Upload time.
- Ingestion status.
- Chunk count.
- Last error or warning if present.
- Actions: refresh, reindex, delete.

Statuses should be rendered from backend enum values:

- `queued`: queued for ingestion.
- `processing`: parsing/indexing.
- `ready`: available for Q&A.
- `partial`: some pages/sheets/files parsed, some failed.
- `failed`: unusable due to parser or file error.
- `unsupported`: unsupported format or missing converter.
- `deleted`: only if backend returns historical deleted records.

Do not fake success on the frontend. Use backend status.

### Upload Progress

For initial implementation, coarse progress is enough:

- Uploading files.
- Backend accepted job.
- Polling ingestion status.
- Ready/partial/failed.

If backend exposes an ingest job endpoint, poll it until terminal status.

## Settings Page Cleanup

Remove the old manual knowledge-entry UI from `SettingsPage`.

Specific cleanup:

- Remove `KnowledgeEntry` state used only for manual entries.
- Remove the `faq` form state.
- Remove `saveKnowledge`.
- Remove the `api.knowledge()` call from the settings load flow if only used by removed panels.
- Remove imports that become unused.
- Leave unrelated settings intact.

Important: the `knowledgeBaseEnabled` toggle may still be used by the legacy email-processing flow. Do not remove that toggle unless the backend agent explicitly migrates or removes the legacy flow.

## Expected API Client Surface

Implement frontend client methods after backend contract is available. Expected shape:

```ts
api.collegeKnowledgeDocuments()
api.uploadCollegeKnowledgeDocuments(files: File[], relativePaths?: string[])
api.reindexCollegeKnowledgeDocument(documentId: string)
api.deleteCollegeKnowledgeDocument(documentId: string)
api.askCollegeKnowledge(input)
```

Do not hard-code final URLs until the backend agent records them in `docs/college-knowledge-backend-agent.md`.

Expected route family:

- `GET /college-knowledge/documents`
- `POST /college-knowledge/documents/upload`
- `POST /college-knowledge/documents/:id/reindex`
- `DELETE /college-knowledge/documents/:id`
- `POST /college-knowledge/chat`

## Expected Response Types

Consume shared types from `packages/shared/src/index.ts` after the backend agent adds them.

Expected minimum shapes:

```ts
type CollegeKnowledgeDocument = {
  id: string;
  fileName: string;
  relativePath: string | null;
  extension: string;
  status: "queued" | "processing" | "ready" | "partial" | "failed" | "unsupported";
  chunkCount: number;
  warning: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

type CollegeKnowledgeSource = {
  documentId: string;
  fileName: string;
  relativePath: string | null;
  locator: string;
  snippet: string;
};

type CollegeKnowledgeChatResponse = {
  answer: string;
  answerable: boolean;
  sources: CollegeKnowledgeSource[];
};
```

If backend names differ, use the backend's final shared types.

## UX Acceptance Criteria

- Sidebar shows `书院知识问答`.
- `/college-knowledge` has two tabs: `知识问答` and `知识文档录入`.
- Settings page no longer shows `新增知识库` or `知识库条目`.
- The Q&A tab supports chat-style interaction and optional image upload.
- Assistant answers display source references returned by backend.
- The document tab supports file/folder upload and shows backend ingestion status.
- Old `.doc` and `.ppt` files are not silently accepted as ready if backend cannot convert them.
- Switching to another sidebar page does not wipe the college knowledge page state after first visit.
- Frontend does not implement or duplicate backend retrieval logic.

## Validation

Frontend agent should run:

- `pnpm --filter @harmonia/web typecheck`
- `pnpm --filter @harmonia/web build`

If backend contract types changed:

- `pnpm --filter @harmonia/api typecheck`
- `pnpm review`

Record validation results in `docs/frontend-agent.md`.

## Implementation Progress

### 2026-06-25

- Implemented the protected `/college-knowledge` frontend route and added the `书院知识问答` sidebar entry.
- Built `CollegeKnowledgePage` with two tabs:
  - `知识问答`: chat-style UI, optional image attachment upload, backend answer rendering, warning display, and source reference cards.
  - `知识文档录入`: file/folder selection, `webkitRelativePath` preservation through `relativePaths`, upload submission, backend document status table, reindex, delete, and refresh actions.
- Added college knowledge API client wrappers for document list/upload/reindex/delete and multipart chat.
- Removed only the Settings page `新增知识库` and `知识库条目` panels and their page-local state/load path; `knowledgeBaseEnabled` remains available.
- Added responsive frontend styles for chat bubbles, source cards, upload summaries, document tables, and document ingestion status badges.
- Frontend validation passed:
  - `pnpm --filter @harmonia/web typecheck`
  - `pnpm --filter @harmonia/web build`
