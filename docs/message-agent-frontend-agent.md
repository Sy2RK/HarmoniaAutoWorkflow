# Message Agent Frontend Agent Requirements

Last updated: 2026-06-29 CST

This document is the frontend-only implementation brief for the new `邮件写作 Agent` module. Frontend agents must read this before touching message-agent navigation, pages, API client calls, upload UI, chat UI, draft preview, DOCX download, or shared type consumption.

## Goal

Build a new sidebar module named `邮件写作 Agent`. It temporarily replaces the broken Outlook automation workflow by letting staff manually upload reference email files, paste or describe a current email/request, chat with the Agent, answer follow-up questions, preview the generated email, and download it as a `.docx` when needed.

The module must be independent from `书院知识问答`. Do not modify the existing college knowledge page except for shared layout/navigation work that is strictly needed to add the new sidebar entry.

## Frontend Scope

Frontend owns:

- Sidebar navigation entry and route.
- Page layout for `邮件写作 Agent`.
- Reference/sample file upload UI.
- Current request input UI: pasted email text, files, images, and chat messages.
- Chat transcript with follow-up questions.
- Draft preview and manual editing.
- Source/template reference display.
- DOCX download button.
- Client-side validation and user-facing warnings.
- API client wrappers.

Frontend does not own:

- File parsing.
- PDF/DOCX/XLSX extraction.
- Template extraction.
- Retrieval/reranking.
- AI prompt implementation.
- DOCX generation.
- Backend storage.
- Mail sending or Outlook Graph integration.

Backend behavior is specified in `docs/message-agent-backend-agent.md`.

## Navigation

Add one protected sidebar item:

- Label: `邮件写作 Agent`
- Route: `/message-agent`
- Suggested icon: `MessagesSquare`, `BotMessageSquare`, `MailPlus`, or another existing `lucide-react` icon.

This should be a normal protected app page. Keep it visually aligned with the current compact operations-console style.

## Page Structure

Suggested first-version layout:

```text
邮件写作 Agent
  [Reference Library / 参考邮件库]
    upload files/folder
    template/source status

  [Conversation / 对话]
    chat history
    text composer
    image/file attach controls

  [Draft / 邮件草稿]
    subject preview
    body preview
    editable subject/body
    source references
    download DOCX
```

Avoid a landing page. The first screen should be the usable tool.

## Supported Inputs In UI

Allow users to upload parseable reference/request documents only through the reference library and current request file upload controls:

- `.xlsx`
- `.docx`
- `.pdf`
- `.md`
- `.txt`
- `.csv`

Images such as `.png`, `.jpg`, `.jpeg`, and `.webp` are chat-only multimodal attachments. They must not be advertised or accepted in the reference library/current request document upload controls.

First version should not advertise `.msg` or old `.doc` support. If users select them through a browser override or folder upload, the frontend should ignore them or display a clean unsupported warning instead of adding them to the parseable-document upload queue.

Ignore or warn about Office temp files beginning with `~$`.

## Sample-Aware UX

The UI should make the intended workflow obvious without long instruction blocks:

1. Upload reference materials, especially `MessageAgent/sample_messages/邮件常用库.xlsx`.
2. Paste the current email/request or describe the task.
3. Answer any follow-up questions the Agent asks.
4. Review/edit the generated subject and body.
5. Download DOCX if needed.

Do not include lengthy in-app explanations of implementation details, parser mechanics, or AI internals.

## Reference Categories

When backend returns templates/categories, display friendly names:

- `facility_notice`: `物业施工维护通知`
- `youth_league`: `团组织相关回复`
- `electricity_subsidy`: `送电/电费`
- `function_room`: `功能房`
- `property_staff`: `物业人员相关`
- `bfmo_coordination`: `BFMO/部门沟通`
- `recommendation_letter`: `奖学金推荐信`
- `event_registration`: `活动报名回复`
- `format_reminder`: `邮件格式提醒`
- `general_reply`: `通用回复`

These categories come from the current sample materials and `邮件常用库.xlsx`.

## Chat Behavior

The conversation area should support:

- User text messages.
- Optional image attachments.
- Optional image attachments are for multimodal understanding only, not file parsing.
- Assistant follow-up questions.
- Assistant final draft response.
- Display of source/reference cards tied to assistant turns.
- Loading/disabled state while generating.
- Clear session action.

If backend returns structured follow-up questions, render them as short question cards. The user can answer in the chat composer; do not build complex forms unless backend later requires slot-specific forms.

## Draft Preview And Editing

When backend returns a draft:

- Show subject and body in a preview panel.
- Allow manual editing of subject/body.
- Save edits through backend `PATCH` route before downloading DOCX.
- Preserve line breaks.
- Provide a `下载 DOCX` button only when a draft exists.
- Provide copy buttons for subject/body if easy and consistent with existing UI.

Generated output is a draft only. Do not add any send-mail button.

## Source Display

For each generated draft or follow-up decision, display backend-provided source references:

- source file name
- source type/template category
- locator if provided, such as sheet/cell/row, DOCX section, PDF page
- warning icon or text if extraction quality is low

Do not invent source references on the frontend.

## API Client Expectations

Exact names depend on backend implementation, but expected endpoints are:

- `POST /message-agent/sessions`
- `GET /message-agent/sessions/:id`
- `POST /message-agent/sessions/:id/files`
- `POST /message-agent/sessions/:id/chat`
- `DELETE /message-agent/sessions/:id/messages`
- `PATCH /message-agent/sessions/:id/draft`
- `GET /message-agent/sessions/:id/draft.docx`
- `DELETE /message-agent/sessions/:id`

Add methods to `apps/web/src/api/client.ts` after shared types exist.

## Shared Types To Consume

Consume shared backend types from `packages/shared/src/index.ts` once added:

- `MessageAgentSession`
- `MessageAgentMessage`
- `MessageAgentSource`
- `MessageAgentTemplate`
- `MessageAgentDraft`
- `MessageAgentQuestion`
- `MessageAgentChatResponse`
- `MessageAgentTemplateCategory`
- `MessageAgentFileStatus`

Do not duplicate backend business enums in the page if shared exports are available.

## State Management

First version can keep the active session ID in component state. If the backend supports durable sessions:

- Create a session on first page entry or first user action.
- Reload the active session after refresh if session ID is saved in `localStorage`.
- Provide `清空会话` to delete/abandon the current session and start fresh.

Do not store uploaded source document contents or template library in browser `localStorage`.

## Error And Warning Handling

Display clean warnings for:

- unsupported `.msg` or `.doc`
- ignored `~$` temp files
- PDF Portfolio shell extraction / low-quality text extraction
- failed DOCX export
- model unavailable
- missing required information

Raw backend JSON should be converted to readable messages using the existing `readableError` style if available.

## Design Guidance

Keep the UI compact and operational:

- No hero page.
- No marketing copy.
- Use panels/tabs only where they reduce clutter.
- Use icons for upload, send, refresh, delete, copy, download.
- Keep cards for repeated source/template items, not for entire page sections inside other cards.
- Ensure long Chinese/English subject lines wrap.
- Keep draft editor comfortable for long bilingual emails.

## Acceptance Criteria

- Sidebar has `邮件写作 Agent`.
- `/message-agent` shows a usable upload + chat + draft workflow.
- `/message-agent` has top tabs `邮件写作` and `参考邮件库录入`, defaulting to `邮件写作`.
- Users can upload `邮件常用库.xlsx` and supported parseable documents through the page.
- Reference/request upload controls accept and display only `.xlsx`, `.docx`, `.pdf`, `.md`, `.txt`, and `.csv`.
- Images are available only as chat attachments for multimodal understanding, not as parseable document uploads.
- `.msg` and old `.doc` are not advertised as supported.
- Users can paste a current email/request and chat with the Agent.
- Follow-up questions are visible before final draft when backend returns them.
- Generated subject/body are previewed and editable.
- Source references are shown with generated results.
- DOCX download is available for generated/edited drafts.
- There is no email sending action.
- Existing `书院知识问答` UI still works unchanged.
- The page does not expose `快速` / `精准` mode controls for message-agent chat.

## Validation

Frontend validation:

- `pnpm --filter @harmonia/web typecheck`
- `pnpm --filter @harmonia/web build`

If shared types or backend contracts changed:

- `pnpm --filter @harmonia/api typecheck`
- `pnpm review`

Record progress in `docs/frontend-agent.md` after implementation.

## Implementation Progress

### 2026-06-29

- Implemented the protected `/message-agent` route and `邮件写作 Agent` sidebar entry.
- Built the frontend-only `MessageAgentPage` workflow:
  - reference mail library upload with file/folder selection
  - current request file upload
  - text and image chat
  - follow-up question cards
  - source reference rendering
  - editable subject/body draft preview
  - draft save through backend `PATCH`
  - DOCX download through backend export endpoint
  - session refresh and clear actions
- Added message-agent API wrappers in the web client for sessions, uploads, chat, draft edits, DOCX download, and deletion.
- Added compact responsive styles for the module's upload, chat, source, template, and draft editor surfaces.
- Confirmed no frontend file parsing, template extraction, AI generation, DOCX generation, Outlook sending, or `书院知识问答` page changes were introduced.
- Frontend validation passed:
  - `pnpm --filter @harmonia/web typecheck`
  - `pnpm --filter @harmonia/web build`

### 2026-06-29 Upload Boundary Correction

- Corrected the frontend upload boundary so reference library/current request upload controls only accept and display parseable documents: `.xlsx`, `.docx`, `.pdf`, `.md`, `.txt`, `.csv`.
- Removed image extensions from document upload `accept` values and user-facing upload hints.
- Kept images only in the chat composer as `添加聊天图片` multimodal attachments.
- Added client-side filtering and clear warnings for image files, `.msg`, old `.doc`, and other non-parseable files selected through browser overrides or folder upload.

### 2026-06-29 Tab Split And Default Chat Mode

- Split `/message-agent` into two top-level tabs: `邮件写作` and `参考邮件库录入`, defaulting to `邮件写作`.
- Removed the frontend `快速` / `精准` mode switch and stopped sending a message-agent `mode` field; chat requests use the backend default mode.
- Kept current request document upload, chat, follow-up questions, source references, draft editing, DOCX download, and `清空会话` in the `邮件写作` tab.
- Moved reference library file/folder upload, parsed reference source status, unsupported/warning display, and template list into the `参考邮件库录入` tab.

## Prompt To Send To Frontend Agent

请实现独立的 `邮件写作 Agent` 前端模块，先阅读 `docs/message-agent-frontend-agent.md` 和 `docs/message-agent-backend-agent.md` 的 API 边界。新增 `/message-agent` 侧边栏入口和页面，支持上传参考邮件库/当前请求文件、图片和文本对话，展示追问、来源引用、邮件主题与正文草稿，允许编辑并下载 DOCX；不要实现文件解析、模板提炼、AI 生成、DOCX 生成或邮件发送，也不要改动现有 `书院知识问答` 功能。
