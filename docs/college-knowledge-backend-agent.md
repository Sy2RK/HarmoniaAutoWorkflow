# College Knowledge Q&A Backend Agent Requirements

Last updated: 2026-06-25 CST

This document is the backend-only implementation brief for the new `书院知识问答` RAG-style module. Backend agents must read this before touching document ingestion, parsing, retrieval, model calls, storage, database schema, or API contracts for the college knowledge module.

## Product Goal

Build an independent AI knowledge Q&A backend for college documents.

Inputs:

- Directly uploaded files.
- Browser folder uploads with relative paths.
- Optional zip archives.

Supported target formats:

- `.docx`
- `.pptx`
- `.xlsx`
- `.xls`
- `.pdf`
- `.md`
- `.txt`
- `.csv`
- Old `.doc` and `.ppt` through an optional converter.

Outputs:

- Chat answers grounded only in uploaded knowledge documents.
- Source citations per answer, including file name and precise locator such as page, sheet row, slide, heading, or chunk.

No embedding model is available for the first implementation. Use Markdown normalization + lexical retrieval + model reranking.

## Ownership Boundary

Backend agents own:

- New API route family under `/college-knowledge`.
- Document upload handling.
- File storage and deduplication.
- Parser/converter integration.
- Canonical Markdown extraction.
- Chunking and source metadata.
- Retrieval and reranking.
- Chat answer generation.
- Database schema and repository changes.
- Shared API types in `packages/shared/src/index.ts`.
- Backend tests and contract coverage.

Backend agents must not:

- Implement React pages, sidebar navigation, CSS, browser file inputs, or settings-page UI cleanup.
- Modify `apps/web/src/pages/CollegeKnowledgePage.tsx`, `apps/web/src/components/Layout.tsx`, or frontend styling.
- Put frontend-only state or display rules into backend code.

Frontend behavior is specified only in `docs/college-knowledge-frontend-agent.md`.

## Coordination Order

Do not run backend and frontend agents against this feature in fully parallel edit mode if shared types or API routes are still changing.

Recommended order:

1. Backend agent creates shared types, routes, ingestion service, retrieval service, and tests.
2. Backend agent records final API surface in this document.
3. Frontend agent consumes the recorded API surface and implements UI.

If both agents are active at once, backend owns `packages/shared/src/index.ts` first. Frontend should treat shared contract changes as read-only until backend finishes.

## Architecture Decision

Use Markdown as the canonical text representation, but do not send the full knowledge base to the model for every question.

Pipeline:

```text
uploaded files
  -> persisted originals
  -> parser/converter
  -> canonical Markdown + structured metadata
  -> source-aware chunks
  -> lexical index
  -> query retrieval
  -> LLM rerank
  -> source-grounded answer generation
```

This gives the compatibility benefits of Markdown while keeping answers efficient, citable, and less noisy.

## Data Model

Add new storage separate from the legacy `knowledge_entries` table.

Suggested SQLite/Postgres entities:

### `college_knowledge_documents`

- `id`
- `file_name`
- `relative_path`
- `extension`
- `mime_type`
- `size_bytes`
- `sha256`
- `status`
- `warning`
- `error`
- `chunk_count`
- `created_at`
- `updated_at`

Status enum:

- `queued`
- `processing`
- `ready`
- `partial`
- `failed`
- `unsupported`

### `college_knowledge_chunks`

- `id`
- `document_id`
- `chunk_index`
- `text`
- `markdown`
- `normalized_text`
- `source_type`
- `locator`
- `page_number`
- `slide_number`
- `sheet_name`
- `row_number`
- `heading`
- `metadata_json`
- `created_at`

The chunk table must contain enough metadata to cite exact sources without asking the model to invent citations.

### Optional `college_knowledge_ingest_jobs`

Use this if upload batches need independent progress:

- `id`
- `status`
- `total_files`
- `processed_files`
- `created_document_ids_json`
- `error`
- `created_at`
- `updated_at`

### Optional Chat Tables

Chat persistence can be deferred. If implemented:

- `college_knowledge_chat_sessions`
- `college_knowledge_chat_messages`

Do not block the first implementation on chat persistence.

## File Storage

Store originals under:

```text
storage/college-knowledge/documents/{documentId}/original/{fileName}
storage/college-knowledge/documents/{documentId}/extracted.md
storage/college-knowledge/documents/{documentId}/metadata.json
```

Ignore temporary lock files:

- Names beginning with `~$`
- Hidden system files such as `.DS_Store`

Use SHA-256 for deduplication. If an identical file is uploaded again, either reuse the existing document or create a new document with the same hash but avoid duplicate chunks. Choose one behavior and test it.

## Parser Compatibility

Use a canonical parser interface:

```ts
type ParsedDocument = {
  markdown: string;
  chunks: ParsedChunkSeed[];
  warnings: string[];
};
```

### `.xlsx` and `.xls`

- Use the existing `xlsx` dependency.
- Treat each meaningful row as a source-aware chunk when the sheet is FAQ-like.
- Preserve `sheetName`, `rowNumber`, and key column names in metadata.
- For the `RAGMaterial` sample workbook, each row should become a useful FAQ chunk with question, type, tags, answer, and scope metadata.

### `.pdf`

- Use the existing `pdf-parse` / `PDFParse` capability.
- Extract text per page when possible.
- Chunk by page, heading, or paragraph.
- If a page has too little text, mark a warning and optionally use the multimodal model to extract page text from a rendered image.
- Preserve page number in every PDF chunk.

### `.docx`

- Prefer a robust `.docx` extraction path that preserves headings, paragraphs, and tables.
- `mammoth` is acceptable if adding a dependency is allowed; otherwise parse OOXML directly from the zip package.
- Preserve heading context and table rows in metadata.

### `.pptx`

- Extract slide text from OOXML.
- One slide can be one chunk unless very long.
- Preserve slide number.

### `.md` / `.txt`

- Read as UTF-8 text.
- Chunk by heading first, then by paragraph length.

### `.csv`

- Use `xlsx` or a CSV parser.
- Treat rows as structured chunks and preserve row number.

### `.zip`

- Treat zip as a batch container, not as a knowledge document.
- Safely extract supported inner files only.
- Preserve each inner file's relative path as source metadata.
- Reject zip entries with absolute paths, `..`, drive letters, or path traversal attempts.
- Enforce maximum total uncompressed size and maximum file count.
- Ignore temporary files inside the archive, including `~$...` and `.DS_Store`.

### Old `.doc` and `.ppt`

These binary formats need a converter for highest compatibility.

Recommended operational choice:

- Add config such as `DOCUMENT_CONVERTER=none|libreoffice|tika`.
- If `libreoffice` is configured, run headless conversion to `.docx` / `.pptx` or `.pdf` before parsing.
- If no converter is available, accept upload but set document status to `unsupported` with an explicit message like `需要安装 LibreOffice 或 Tika 才能解析旧版 .doc/.ppt 文件`.

Do not silently mark old binary files as ready if they were not parsed.

## Chunking Rules

Chunking must preserve source metadata.

Default target:

- 400-800 Chinese characters per chunk.
- Small overlap only for long prose, around 80-120 characters.
- Never merge content from different files.
- Prefer not to merge different PDF pages, slides, or spreadsheet rows.

Chunk priority:

1. Excel FAQ row.
2. PDF page/heading.
3. Word heading/section.
4. PPT slide.
5. Markdown heading.
6. Paragraph fallback.

Each chunk should include:

- Human-readable locator.
- Machine metadata for citation.
- Normalized searchable text.

## Retrieval Without Embedding

Because the available models are chat/multimodal generation models, not embedding models, implement a no-embedding retrieval stack.

### Query Normalization

- Normalize Unicode.
- Convert full-width punctuation and spaces.
- Lowercase English.
- Strip repeated whitespace.
- Generate English word tokens and Chinese character bigrams/trigrams.

### Candidate Recall

Run multiple recall strategies and merge scores:

- Exact or near-exact FAQ question match.
- BM25 or BM25-like lexical scoring over normalized chunk text.
- Chinese n-gram overlap scoring.
- Metadata boost from file name, relative path, sheet headers, tags, type, scope, and year.

For the current small knowledge base, in-memory scoring over all chunks is acceptable. Rebuild the in-memory index on startup and after ingestion changes.

### Candidate Limits

- Recall top 30-50 chunks.
- Rerank down to 5-8 chunks before answer generation.

### LLM Rerank

Use the configured OpenAI-compatible chat model to rerank candidates.

Rerank prompt requirements:

- Input: user question, optional image-derived question text, candidate chunks with IDs and source metadata.
- Output: strict JSON list of selected chunk IDs with short relevance reasons.
- The model may reject irrelevant chunks.

If rerank fails, fall back to lexical top chunks and mark a warning in logs, not in the user-facing answer unless answer quality is affected.

## Image Questions

The chat endpoint must accept optional image files.

Flow:

1. Use the multimodal model to extract or describe the user's image into a text query.
2. Merge the extracted text with the user's typed question.
3. Run normal retrieval.
4. Generate an answer grounded in retrieved chunks.

Do not answer from image-only content unless the answer is also supported by retrieved knowledge, unless the response explicitly says no knowledge-base source was found.

## Answer Generation

Use a strict source-grounded prompt.

Rules:

- Only answer using supplied retrieved chunks.
- If the chunks do not contain enough information, say that the current knowledge base has no clear answer.
- Do not invent policies, dates, room names, contacts, or deadlines.
- Return source IDs used for each answer.
- Preserve source file names and locators from backend metadata, not model-generated citations.

Recommended response object:

```ts
type CollegeKnowledgeChatResponse = {
  answer: string;
  answerable: boolean;
  sources: CollegeKnowledgeSource[];
  warnings?: string[];
};
```

The backend should map selected source IDs to trusted metadata after model generation, rather than trusting raw citation text generated by the model.

## API Contract

Add authenticated route family:

### `GET /college-knowledge/documents`

Returns:

```ts
{
  items: CollegeKnowledgeDocument[];
  total: number;
}
```

### `POST /college-knowledge/documents/upload`

Multipart form data:

- `files`: one or more files.
- `relativePaths`: optional JSON array or repeated field, matching file order when folder upload is used.

Returns either:

```ts
{
  job: CollegeKnowledgeIngestJob;
  documents: CollegeKnowledgeDocument[];
}
```

or, for a simpler first implementation:

```ts
{
  documents: CollegeKnowledgeDocument[];
}
```

Record the final choice in this document after implementation.

### `POST /college-knowledge/documents/:id/reindex`

Re-parses one document and replaces its chunks.

Returns:

```ts
{
  document: CollegeKnowledgeDocument;
}
```

### `DELETE /college-knowledge/documents/:id`

Deletes document and chunks.

Returns:

```ts
{ ok: true }
```

### `POST /college-knowledge/chat`

Accept JSON or multipart depending on image support. Multipart is preferred for image files.

Expected fields:

- `message`: string.
- `sessionId`: optional string.
- `mode`: optional `"fast"` or `"precise"`. `fast` skips LLM rerank and uses lexical top chunks directly; `precise` enables LLM rerank for the request.
- `images`: optional files.

Returns:

```ts
{
  answer: string;
  answerable: boolean;
  sources: CollegeKnowledgeSource[];
  warnings?: string[];
}
```

## Shared Types

Add shared types to `packages/shared/src/index.ts` before frontend work consumes them.

Expected minimum:

```ts
export const collegeKnowledgeDocumentStatuses = [
  "queued",
  "processing",
  "ready",
  "partial",
  "failed",
  "unsupported"
] as const;

export type CollegeKnowledgeDocumentStatus = (typeof collegeKnowledgeDocumentStatuses)[number];

export const collegeKnowledgeChatModes = ["fast", "precise"] as const;

export type CollegeKnowledgeChatMode = (typeof collegeKnowledgeChatModes)[number];

export type CollegeKnowledgeDocument = {
  id: string;
  fileName: string;
  relativePath: string | null;
  extension: string;
  status: CollegeKnowledgeDocumentStatus;
  chunkCount: number;
  warning: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CollegeKnowledgeSource = {
  documentId: string;
  fileName: string;
  relativePath: string | null;
  locator: string;
  snippet: string;
};
```

Final fields may be extended, but do not remove these concepts without updating the frontend brief.

## Legacy Knowledge Base

The existing `/knowledge-base` endpoint and `knowledge_entries` table are part of the old mailbox-processing flow. Do not delete them in this backend task unless the leader explicitly requests migration.

This new module should use new routes and new storage. It should not depend on old `KnowledgeEntry` records.

## Security And Safety

- Require authenticated admin session for all routes.
- Enforce upload size limits.
- Restrict stored paths to the configured storage root.
- Never trust uploaded relative paths for filesystem writes without sanitization.
- Ignore or reject executable/script-like files.
- Keep source document deletion scoped to `storage/college-knowledge`.
- Log parser errors but return clean user-facing error messages.

## Test Plan

Backend tests must cover:

- Upload accepts multiple files and preserves relative paths.
- Temporary files like `~$...xlsx` are ignored.
- XLSX sample from `RAGMaterial` parses into FAQ-like chunks with sheet and row locators.
- PDF parsing produces page locators.
- DOCX parsing produces non-empty chunks with heading/table context when present.
- PPTX parsing produces slide locators.
- Old `.doc` / `.ppt` without converter becomes `unsupported`, not `ready`.
- Document delete removes chunks and excludes the document from future retrieval.
- Reindex replaces old chunks.
- Retrieval returns the expected source for questions like `怎么入党？` from the sample workbook.
- Chat answer includes trusted source metadata.
- If retrieval finds no relevant source, the answer is non-fabricated and `answerable` is false.
- Image chat path calls the multimodal extraction step before retrieval.

Validation commands:

- `pnpm --filter @harmonia/api typecheck`
- `pnpm --filter @harmonia/api test`
- `pnpm review`

Record implementation progress and final API surface in `docs/backend-agent.md`.

## Implementation Notes From Feasibility Check

The local `RAGMaterial` sample contains an extracted college corpus, including an XLSX FAQ-like workbook, DOCX files, and PDFs. The current project already has `xlsx` and `pdf-parse` available. The environment did not show installed `soffice`, `libreoffice`, `pandoc`, `antiword`, `catdoc`, or `pdftotext`, so old binary Office formats need an explicit converter dependency or must be marked unsupported.

## Implementation Progress

### 2026-06-25 Fast Path Update

- Default Q&A path now skips LLM rerank for speed and sends the lexical top 8 chunks directly to answer generation.
- Optional rerank support remains available through the backend build option `collegeKnowledgeRerankEnabled`.
- RAGMaterial local smoke check: 3 representative questions made 0 rerank calls, 3 answer calls, and retained correct top sources for 入党、功能房、退宿.

### 2026-06-25 Request-Level Mode Update

- Added shared `CollegeKnowledgeChatMode` values: `fast` and `precise`.
- Extended JSON and multipart `/college-knowledge/chat` requests to accept optional `mode`.
- `fast` mode uses lexical top 8 chunks directly; `precise` mode retrieves a wider candidate set and runs LLM rerank before answer generation.
- Backend validation passed:
  - `pnpm --filter @harmonia/api test -- apps/api/test/collegeKnowledge.test.ts`
  - `pnpm --filter @harmonia/api typecheck`
