# Message Agent Backend Agent Requirements

Last updated: 2026-06-29 CST

This document is the backend-only implementation brief for the new `邮件写作 Agent` module. Backend agents must read this before touching message-agent upload, parsing, template extraction, chat state, draft generation, DOCX export, storage, shared contracts, or API routes.

## Goal

Build an independent conversational AI module that temporarily replaces the broken Outlook automation path. The user manually uploads email/reference files and pastes or types the current email/request. The system should extract reusable templates from reference materials, ask for missing information through conversation, and generate a polished college-office email body as plain text and, when requested, as a `.docx` file.

This module must be independent from `书院知识问答`. Reuse parsing and retrieval ideas where helpful, but do not write into `college_knowledge_*` tables, `storage/college-knowledge`, or `/college-knowledge` routes.

## Explicit Non-Goals

- Do not implement Outlook Graph sync, mailbox authorization, automatic sending, or draft sending.
- Do not parse `.msg` or old `.doc` in the first version. Ignore or mark them unsupported with a clear reason.
- Do not change the existing college knowledge Q&A behavior.
- Do not make generated emails send automatically.
- Do not store API keys in frontend-visible payloads.

## Sample Material Findings

Reference folder: `MessageAgent/sample_messages`.

Current sample distribution:

- Many Outlook-exported `.pdf` files for notices and replies.
- `邮件常用库.xlsx`, the highest-value source, with columns:
  - `物业施工维护相关`
  - `【团组织相关】`
  - `【送电】`
  - `纪念品`
  - `功能房`
  - `物业人员`
  - `BFMO`
  - one unlabeled general-format-reminder column
- `.docx` examples:
  - `送电.docx`
  - `祥波书院奖学金推荐信提交 Harmonia College Scholarship Recommendation Letter Request.docx`
  - `隶属老师参与祥波邮件-周漫璐.docx`
- `.msg` and `.doc` exist but are out of scope for first version.

Important parser note: many PDF files are Outlook PDF Portfolio exports. Plain `pdf-parse` often extracts only a shell message such as "open this PDF portfolio in Acrobat" rather than the real email body. First version should still accept PDFs and attempt text extraction, but it must report low-quality extraction warnings. The reliable source for templates is `邮件常用库.xlsx` and DOCX files.

## First-Version Template Categories

Template extraction should map examples into these categories. Categories can be adjusted by AI classification, but keep these as first-version labels:

- `facility_notice`: bilingual or Chinese notices for maintenance, construction, cleaning, water shutoff, pest control, curtain replacement, water dispenser cleaning, tree clearing, lightning safety, and dormitory appliance cleaning.
- `youth_league`: replies and instructions for Communist Youth League organization transfer, reporting, membership archive lookup, missing application records, file naming requirements, and delayed approval.
- `electricity_subsidy`: annual electricity subsidy / free electricity allocation notices and electricity fee explanations.
- `function_room`: room reservation, no-show sign-in cancellation, opening hours, blacklisting, special room-use approval, maintenance cancellation, and room policy replies.
- `property_staff`: responses about property staff, cleaners, rest facilities, public-area sanitation, and facility-care feedback.
- `bfmo_coordination`: formal coordination emails to BFMO or university departments, including construction schedule negotiation and information requests.
- `recommendation_letter`: scholarship recommendation letter request emails.
- `event_registration`: replies to faculty/staff who registered for Harmonia College activities.
- `format_reminder`: short reply reminding senders to include salutation, body, and signature.
- `general_reply`: fallback for student suggestions, complaints, consultation, or requests when no tighter category fits.

## Email Style Requirements

Generated emails should follow the sample style:

- Use polite college-office tone.
- Prefer concise paragraphs, not legalistic wording.
- Preserve bilingual style when the selected template/source is bilingual or when the user asks for bilingual output.
- Use Chinese-only for ordinary Chinese student replies unless the incoming request is English or the user asks for English/bilingual.
- Common signatures may include:
  - `顺祝，`
  - `时祺`
  - `祥波书院 | Harmonia College Office`
  - `邮件 | Email: harmonia@cuhk.edu.cn`
  - `书院热线 | College Hotline: (86)0755-23515400`
  - `地址 | Address：深圳市龙岗区龙翔大道2001号香港中文大学（深圳）祥波书院`
- Do not invent official policy details, dates, locations, contact people, WeChat IDs, or attachment names. Ask follow-up questions when missing.

## Conversation Behavior

The backend agent must support a multi-turn session:

1. User uploads reference files and/or current request files/images.
2. Backend extracts text and stores source records with warnings.
3. Backend retrieves likely templates and classifies the request category.
4. Backend identifies missing slots.
5. If information is missing, return follow-up questions instead of a final draft.
6. Once enough information is present, generate:
   - plain-text email draft
   - selected reference sources
   - missing/uncertain fields
   - optional attachment suggestions
   - exportable DOCX content

Example missing slots:

- For facility notices: project/work item, location, date, time period, affected people, reminder points, contact channel, bilingual requirement.
- For youth league: student name, request status, missing document type, required deadline, file naming rule, whether attached guide should be referenced.
- For function rooms: room number, reservation time, problem type, current decision, policy basis, whether approval or rejection is intended.
- For BFMO: target department/contact, requested action, preferred schedule, reason, urgency, background of previous communication.
- For recommendation letters: applicant name, award name, academic year, recommender identity, submission deadline, required format.

## Backend Scope

Implement backend-owned pieces only:

- New route family under `/message-agent`.
- Upload handling for reference files and user request files.
- Text extraction and source normalization.
- Template extraction from source files.
- Retrieval/classification over templates and current request context.
- Multi-turn session state.
- AI prompt orchestration.
- DOCX export generation.
- Storage and cleanup.
- Shared API types.
- Tests.

Do not implement React pages, sidebar navigation, CSS, browser localStorage behavior, or frontend preview controls.

## Suggested Storage

Use separate storage:

```text
storage/message-agent/
  sessions/{sessionId}/
    input/
    sources/
    generated/
    session.json
  template-library/
    templates.json
    sources/
```

First version can use JSON-file storage under `storage/message-agent` to reduce schema risk, as long as it is durable across restart. If database storage is chosen, use new tables named `message_agent_*`, not `college_knowledge_*`.

## Parser Strategy

Create a message-agent parser layer, optionally backed by college-knowledge parser internals:

- `.xlsx`: use `xlsx`; treat each non-empty cell in `邮件常用库.xlsx` as a potential template example with category derived from column header.
- `.docx`: parse OOXML text similarly to college knowledge parser; preserve paragraph order.
- `.pdf`: use current PDF text extraction; if extracted text looks like PDF Portfolio shell text, store a warning such as `PDF_PORTFOLIO_TEXT_NOT_EXTRACTED`.
- `.md`, `.txt`, `.csv`: optional but cheap to support.
- images: pass to multimodal model for description/OCR-like extraction when included in chat context.
- `.msg`: unsupported in first version.
- `.doc`: unsupported in first version.
- temporary files beginning with `~$`: ignore.

If this overlaps with `apps/api/src/college-knowledge/parser.ts`, either:

- factor neutral helpers into `apps/api/src/document-processing`, with tests proving college knowledge behavior is unchanged, or
- copy only the required parsing logic into `apps/api/src/message-agent` for the first version.

Prefer the safer first-version path if time is short.

## Template Extraction

A normalized template should include at least:

```ts
type MessageAgentTemplate = {
  id: string;
  category: MessageAgentTemplateCategory;
  title: string;
  language: "zh" | "en" | "bilingual" | "mixed";
  audience: "student" | "teachers_students" | "department" | "recommender" | "staff" | "unknown";
  subjectPattern: string | null;
  bodySkeleton: string;
  requiredSlots: MessageAgentSlot[];
  optionalSlots: MessageAgentSlot[];
  tone: string;
  signatureStyle: string | null;
  sourceIds: string[];
  createdAt: string;
  updatedAt: string;
};
```

First version can generate templates lazily at upload time using AI. Cache them in session/library storage so later chats do not re-extract every time.

## AI Responsibilities

Use the configured OpenAI-compatible model client.

Recommended AI steps:

1. `classifyMessageAgentRequest`: classify category, language, audience, intent, and urgency.
2. `extractMessageAgentTemplate`: convert sample content into a structured template.
3. `planMessageAgentDraft`: compare user request with selected templates and identify missing slots.
4. `generateMessageAgentDraft`: generate final subject/body, not JSON-only user-facing prose.

All AI outputs used by code should be JSON-normalized and validated with zod.

## Retrieval

The reference library is small, so lexical retrieval over template text is enough:

- Score against category, title, source text, body skeleton, and required slots.
- Use uploaded current request text + image extracted text as query.
- Return top 5-8 templates to the AI.
- Optional `mode`:
  - `fast`: lexical top templates directly.
  - `precise`: AI rerank over top candidates.

Do not feed the entire reference corpus to the model every turn unless the corpus is very small and bounded by token limits.

## API Contract Draft

Exact route naming can change, but keep frontend and shared types aligned.

### `POST /message-agent/sessions`

Create a new session.

Returns:

```ts
{ session: MessageAgentSession }
```

### `GET /message-agent/sessions/:id`

Return session, messages, sources, extracted templates, and latest draft.

### `POST /message-agent/sessions/:id/files`

Multipart upload.

Fields:

- `files`: reference or current-request files.
- `fileRole`: `"reference" | "request" | "attachment"` optional, default `"reference"`.
- `relativePaths`: optional JSON array.

Returns source records and warnings.

### `POST /message-agent/sessions/:id/chat`

Accept JSON or multipart.

Fields:

- `message`: user message.
- `mode`: optional `"fast" | "precise"`.
- `images`: optional image files.

Returns:

```ts
type MessageAgentChatResponse = {
  session: MessageAgentSession;
  assistantMessage: MessageAgentMessage;
  draft: MessageAgentDraft | null;
  followUpQuestions: MessageAgentQuestion[];
  sources: MessageAgentSourceRef[];
  warnings: string[];
};
```

### `DELETE /message-agent/sessions/:id/messages`

Clear persisted chat messages for one session while retaining uploaded sources, extracted templates, and the latest draft.

Returns the same shape as `GET /message-agent/sessions/:id`.

### `PATCH /message-agent/sessions/:id/draft`

Persist manual edits to generated subject/body.

### `GET /message-agent/sessions/:id/draft.docx`

Download the latest draft as DOCX.

### `DELETE /message-agent/sessions/:id`

Delete one session and associated generated files.

## Shared Types

Add shared types under `packages/shared/src/index.ts` when implementing.

Minimum concepts:

- `MessageAgentSession`
- `MessageAgentMessage`
- `MessageAgentSource`
- `MessageAgentTemplate`
- `MessageAgentDraft`
- `MessageAgentQuestion`
- `MessageAgentChatResponse`
- `MessageAgentTemplateCategory`
- `MessageAgentFileStatus`

## DOCX Export

Generated DOCX should contain:

- subject line
- email body paragraphs with line breaks preserved
- optional source appendix listing reference files used

Use a Node DOCX library if available or add a lightweight dependency. Do not hand-roll binary DOCX unless necessary. Preserve Chinese/English text and line breaks.

## Safety

- Require authenticated admin session for all routes.
- Enforce upload size and count limits.
- Sanitize filenames and relative paths.
- Store under `storage/message-agent` only.
- Ignore `~$` temporary Office files.
- Keep generated output as draft, never send mail.
- Make unsupported file warnings non-fatal when other files are usable.

## Test Plan

Backend tests should cover:

- Uploading `邮件常用库.xlsx` creates templates for property, youth league, electricity, function room, property staff, BFMO, and format reminder.
- `~$邮件常用库.xlsx` and `~$送电.docx` are ignored.
- `.msg` and `.doc` are recorded as unsupported or ignored per route behavior.
- DOCX examples parse into usable text.
- PDF Portfolio shell text produces a warning and does not become a high-confidence template.
- Chat for a facility notice asks for missing location/date/time when not provided.
- Chat for a function-room request retrieves function-room templates.
- Chat for youth league request retrieves youth-league templates.
- Final draft returns plain text, source refs, and DOCX download.
- Manual draft edit persists and DOCX export uses edited content.
- College knowledge tests remain unchanged.

Validation:

- `pnpm --filter @harmonia/api typecheck`
- `pnpm --filter @harmonia/api test -- apps/api/test/messageAgent.test.ts`
- `pnpm review`

## Prompt To Send To Backend Agent

请实现独立的 `邮件写作 Agent` 后端模块，先阅读 `docs/message-agent-backend-agent.md`。不要改 `/college-knowledge` 或 `college_knowledge_*`，也不要实现 Outlook 自动发送；`.msg` 和旧版 `.doc` 第一版不处理。重点实现 `/message-agent` 会话、文件上传解析、从 `MessageAgent/sample_messages/邮件常用库.xlsx` 与 DOCX/PDF 中提炼模板、对话追问缺失信息、生成纯文本邮件草稿并支持 DOCX 导出，完成后补共享类型与后端测试。
