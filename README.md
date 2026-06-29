# Harmonia Auto Workflow

截至 2026-06-29，本项目是一个面向祥波书院日常行政工作的本地 Web 自动化系统。最初目标是围绕 Outlook 公共邮箱完成邮件同步、分类、草稿生成和人工审核；在邮箱授权暂时不可用后，项目又新增了多个不依赖邮件上游的独立模块，包括优秀毕业生材料核对、书院奖学金奖项置信度计算、书院知识问答，以及手动上传材料的邮件写作 Agent。

本 README 供后续开发者接手使用，重点说明当前架构、已完成进度、运行方式、目录结构、已知困难和下一步建议。更细的前后端拆分需求文档放在 `docs/` 目录。

GitHub 仓库地址：`https://github.com/Sy2RK/HarmoniaAutoWorkflow`

## 一句话架构

- Monorepo：`pnpm` workspace。
- 后端：`apps/api`，Fastify + TypeScript，默认 SQLite，本地文件系统保存上传文件、任务快照和知识库文档。
- 前端：`apps/web`，React + Vite + TypeScript，统一通过 `apps/web/src/api/client.ts` 调用后端。
- 共享类型：`packages/shared`，前后端共同消费的业务类型、状态枚举和标签。
- AI 接入：OpenAI-compatible HTTP 接口，当前默认面向校内 `https://ai-api.cuhk.edu.cn/v1`，模型可配置为 `qwen3-5-397b-a17b` 或 `gemma-4-31B`。
- 运行数据：默认写入 `storage/`，不应提交到 Git。

## 快速启动

前置要求：

- Node.js 24.x
- pnpm 10.x

```bash
corepack enable
corepack prepare pnpm@10.11.0 --activate
pnpm install
cp .env.example .env
```

开发启动：

```bash
pnpm dev
```

也可以分别启动：

```bash
pnpm dev:api
pnpm dev:web
```

默认地址：

- 前端：`http://localhost:5173`
- 后端健康检查：`http://localhost:4000/health`
- 默认管理员：读取 `.env` 中的 `ADMIN_EMAIL` / `ADMIN_PASSWORD`
- 默认数据库：`storage/harmonia.sqlite`

完整验证：

```bash
pnpm review
```

该命令会依次运行 lint、typecheck、test 和 build。局部开发时常用：

```bash
pnpm --filter @harmonia/api test
pnpm --filter @harmonia/api typecheck
pnpm --filter @harmonia/web typecheck
pnpm --filter @harmonia/web build
```

## 环境配置

主要配置在 `.env`，模板见 `.env.example`。不要把真实 key 写入 README 或提交到 Git。

### 基础服务

```bash
NODE_ENV=development
PORT=4000
WEB_ORIGIN=http://localhost:5173
SESSION_SECRET=change-me-at-least-32-characters
APP_TIMEZONE=Asia/Shanghai
```

### 数据库

默认 SQLite：

```bash
DB_DRIVER=sqlite
SQLITE_DB_PATH=storage/harmonia.sqlite
```

PostgreSQL 仍保留兼容入口：

```bash
DB_DRIVER=postgres
DATABASE_URL=postgres://harmonia:harmonia@localhost:5433/harmonia
```

Docker Compose 路径也保留：

```bash
docker compose up --build
```

### AI 网关

当前项目通过 OpenAI-compatible 客户端访问文本、图片和多模态模型：

```bash
OPENAI_BASE_URL=https://ai-api.cuhk.edu.cn/v1
OPENAI_TEXT_BASE_URL=https://ai-api.cuhk.edu.cn/v1
OPENAI_TEXT_MODEL=qwen3-5-397b-a17b
OPENAI_VISION_BASE_URL=https://ai-api.cuhk.edu.cn/v1
OPENAI_VISION_MODEL=qwen3-5-397b-a17b

SCHOLARSHIP_CHECK_AI_BASE_URL=https://ai-api.cuhk.edu.cn/v1
SCHOLARSHIP_CHECK_AI_MODEL=qwen3-5-397b-a17b
SCHOLARSHIP_CHECK_AI_IMAGES_PER_REQUEST=4
SCHOLARSHIP_CHECK_AI_PDF_IMAGE_WIDTH=1600
AI_ENABLED=true
```

`SCHOLARSHIP_CHECK_AI_MODEL` 可在配置页选择，目前共享类型中允许：

- `qwen3-5-397b-a17b`
- `gemma-4-31B`

## 项目结构

```text
.
├── apps/
│   ├── api/                         # Fastify 后端
│   │   ├── src/
│   │   │   ├── ai/                  # OpenAI-compatible AI 客户端和提示词调用封装
│   │   │   ├── auth/                # 登录、session cookie、鉴权
│   │   │   ├── award-confidence/    # 书院奖学金奖项置信度模块
│   │   │   ├── business/            # 邮件分类、业务处理和原邮件工作流
│   │   │   ├── college-knowledge/   # 书院知识问答 RAG-like 模块
│   │   │   ├── config/              # 环境变量解析
│   │   │   ├── db/                  # SQLite/Postgres/In-memory repository
│   │   │   ├── graph/               # Microsoft Graph 邮箱接入
│   │   │   ├── mail/                # 出站邮件发送适配
│   │   │   ├── message-agent/       # 手动上传式邮件写作 Agent
│   │   │   ├── scholarship-check/   # 优秀毕业生/材料核对模块
│   │   │   ├── storage/             # 文件保存工具
│   │   │   ├── worker/              # 邮箱同步 worker
│   │   │   ├── app.ts               # 路由注册与应用组装
│   │   │   └── index.ts             # API 启动入口
│   │   └── test/                    # 后端 Vitest 测试
│   └── web/                         # React 前端
│       ├── src/
│       │   ├── api/client.ts        # 后端 API 客户端
│       │   ├── components/          # 布局和通用组件
│       │   ├── pages/               # 页面级功能模块
│       │   ├── styles/              # 全局样式
│       │   ├── App.tsx              # 路由和 keep-alive 页面容器
│       │   └── main.tsx
├── packages/
│   └── shared/                      # 前后端共享类型
├── docs/                            # 给前端/后端 agent 的需求和进度文档
├── storage/                         # 本地运行数据，已 gitignore
├── MessageAgent/                    # 本地参考邮件样例，已 gitignore
├── RAGMaterial/                     # 本地知识库样例，已 gitignore
├── ScholarshipCheck/                # 奖项置信度样例，已 gitignore
└── OutstandingGraduateCheck/        # 优秀毕业生材料核对样例，已 gitignore
```

## 前端页面入口

核心路由在 `apps/web/src/App.tsx`：

- `/`：仪表盘
- `/messages`：公共邮箱邮件列表
- `/messages/:id`：单封邮件详情与处理
- `/drafts`：草稿审核
- `/forward-records`：转发记录
- `/scholarship-check`：优秀毕业生材料核对 + 奖项置信度
- `/college-knowledge`：书院知识问答
- `/message-agent`：邮件写作 Agent
- `/settings`：系统配置

`App.tsx` 对主要页面做了 keep-alive 容器处理，因此切换功能页时，正在进行的前端轮询和页面状态不会立刻卸载。后端长任务本身也应以任务快照为准继续运行。

## 后端路由概览

基础路由在 `apps/api/src/app.ts`：

- `GET /health`
- `POST /auth/login`
- `POST /auth/logout`
- `GET /auth/me`
- `GET /dashboard`
- `GET /messages`
- `GET /messages/:id`
- `POST /messages/:id/process`
- `GET /drafts`
- `PATCH /drafts/:id`
- `POST /drafts/:id/send`
- `POST /drafts/:id/reject`
- `POST /drafts/:id/manual`
- `POST /drafts/:id/no-reply`
- `GET /forward-records`
- `GET /settings`
- `PATCH /settings`
- `POST /sync/run`

独立模块路由：

- `apps/api/src/scholarship-check/routes.ts`
  - `GET /scholarship-check/jobs`
  - `POST /scholarship-check/jobs`
  - `GET /scholarship-check/jobs/:id`
  - `PATCH /scholarship-check/jobs/:id/rows/:rowNumber`
  - `POST /scholarship-check/jobs/:id/pause`
  - `POST /scholarship-check/jobs/:id/resume`
  - `POST /scholarship-check/jobs/:id/cancel`
  - `DELETE /scholarship-check/jobs/:id`
  - `GET /scholarship-check/jobs/:id/result`
- `apps/api/src/award-confidence/routes.ts`
  - 奖项置信度任务创建、查询、暂停、恢复、取消、删除、下载。
- `apps/api/src/college-knowledge/routes.ts`
  - 知识文档上传、列表、重建索引、删除、聊天问答。
- `apps/api/src/message-agent/routes.ts`
  - `POST /message-agent/sessions`
  - `GET /message-agent/sessions/:id`
  - `POST /message-agent/sessions/:id/files`
  - `POST /message-agent/sessions/:id/chat`
  - `DELETE /message-agent/sessions/:id/messages`
  - `PATCH /message-agent/sessions/:id/draft`
  - `GET /message-agent/sessions/:id/draft.docx`
  - `DELETE /message-agent/sessions/:id`

## 当前开发进度

### 1. 基础邮箱工作台

已完成：

- 本地管理员登录和 session cookie 鉴权。
- 邮箱邮件列表、邮件详情、草稿审核、转发记录、仪表盘。
- Microsoft Graph device code 登录脚本：`pnpm --filter @harmonia/api graph:login`。
- 邮件分类、功能房申请、转发负责人、人工审核、拒绝、无需回复等基础工作流。
- `MAIL_SENDING_ENABLED` 发送保护，避免测试阶段误发邮件。

当前困难：

- Outlook 公共邮箱授权目前出现问题，原先自动同步链路不能作为稳定输入来源。
- 因此新增了 `Message Agent` 作为临时替代：由用户手动上传邮件原文、附件和参考邮件库，再通过对话生成邮件草稿。

### 2. 优秀毕业生材料核对

前端仍沿用 `/scholarship-check` 路由，但页面展示已改为“优秀毕业生材料核对”。后端模块目录仍是 `scholarship-check`，这是历史命名，后续如要重命名需同步 API、共享类型、测试和文档。

已完成：

- 输入：系统导出原版 `.xlsx` + 申请人证明材料文件夹。
- 证明材料按申请人和分类匹配，支持图片/PDF 等证明材料。
- PDF 证明材料会逐页渲染成图片后提交给多模态模型。
- 输出：处理版 Excel，新增 `核对情况备注` 和 `详细情况` 两列。
- `核对情况备注` 被标准化为四个分类逐行输出：
  - `书院贡献`
  - `学生组织`
  - `社会服务与实践`
  - `奖项`
- 每个分类只能使用五种状态：
  - `未填写`
  - `无证明材料`
  - `部分材料缺失`
  - `部分材料不匹配`
  - `无问题`
- `详细情况` 用于解释每项判定原因。
- `error` 字段保留为技术错误，不再作为业务表格列展示。
- 最近五次核查记录持久保存，支持查看、编辑、删除、下载 Excel。
- 支持暂停、恢复、终止任务。
- 切换页面后后端任务继续执行。
- 已根据实际运行反馈放宽材料核对标准：主要时间、奖项名称或核心事实匹配即可，不应过度追究证明材料措辞差异。

主要文件：

- 后端：`apps/api/src/scholarship-check/`
- 前端：`apps/web/src/pages/ScholarshipCheckPage.tsx`
- 测试：`apps/api/test/scholarshipCheck.test.ts`
- 需求文档：`docs/scholarship-check-backend-agent.md`、`docs/scholarship-check-frontend-agent.md`

当前困难：

- 多模态模型对证明材料的判断仍有不确定性，需要保留人工复核入口。
- 图片/PDF 质量会显著影响结果，扫描件、截图裁剪、文件夹命名混乱都会造成误判。
- 模型调用成本和耗时较高，批量任务依赖稳定网络和网关响应。
- 后端任务快照保存在文件系统中，适合本机部署；若迁移到多人服务端，应考虑数据库化任务状态和对象存储。

### 3. 书院奖学金奖项置信度

这是新增的独立模块，输入仅为一个奖学金个人奖项申请资料 `.xlsx`。

已完成：

- 输入：`ScholarshipCheck/附件2：2025年祥波书院奖学金个人奖项申请资料.xlsx` 格式的 workbook。
- 输出：在原 workbook 基础上，为申请人的两个申请奖项增加置信度字段。
- 计算原则已调整为：只考虑与书院生活、社会服务、书院活动、书院贡献直接相关的条目；GPA、课程成绩、学业排名等学业要素一律不计入，因为这些已经被先行审查。
- 页面上提供公式说明的 `?` 按钮。
- 最近五条历史记录持久保存，删除按钮放在每条记录上。
- 支持暂停、恢复、终止、删除、下载。
- 与材料核对模块的任务状态互不影响。

主要文件：

- 后端：`apps/api/src/award-confidence/`
- 前端：`apps/web/src/pages/ScholarshipCheckPage.tsx`
- 测试：`apps/api/test/awardConfidence.test.ts`

当前困难：

- 置信度是业务排序辅助，不是严格录取结论。
- 目前没有 embedding 或训练模型，主要依赖规则化字段识别、书院相关条目加权和可解释公式。
- 如果后续政策变化，需要优先维护权重和“书院相关”识别规则，而不是只改 UI 文案。

### 4. 书院知识问答

目标是支持大多数主流文档格式的轻量 RAG-like 知识问答系统。当前没有 embedding 模型，采用文档解析、Markdown 化、chunk、词法检索、可选 LLM rerank、来源约束回答。

已完成：

- 侧边栏新增 `书院知识问答`。
- 页面分为：
  - `知识问答`
  - `知识文档录入`
- 支持上传文件、文件夹和 zip。
- 当前支持解析：
  - `.docx`
  - `.pptx`
  - `.xlsx`
  - `.xls`
  - `.pdf`
  - `.md`
  - `.txt`
  - `.csv`
  - `.zip`
- 旧版 `.doc` / `.ppt` 暂不解析，会记录为 unsupported。
- 问答界面为聊天框形式，支持上传图片。
- 回答必须附带知识来源，包括文件名、页码、slide、sheet row 或 chunk locator。
- 前端支持 `快速模式` 和 `精准模式`：
  - 快速模式：跳过 LLM rerank，直接使用词法召回前若干 chunk，速度更快。
  - 精准模式：增加 LLM rerank，通常更准但会明显变慢。
- 聊天记录保存在浏览器 localStorage，刷新页面不清空。
- 支持手动清空会话。

主要文件：

- 后端：`apps/api/src/college-knowledge/`
- 前端：`apps/web/src/pages/CollegeKnowledgePage.tsx`
- 测试：`apps/api/test/collegeKnowledge.test.ts`
- 需求文档：`docs/college-knowledge-backend-agent.md`、`docs/college-knowledge-frontend-agent.md`

当前困难：

- 暂无 embedding 模型。小体量知识库下，词法检索 + chunk 策略可用，但语义召回不如向量检索。
- 精准模式慢，主要耗时来自 LLM rerank 和最终回答生成，实测可能到 30-60 秒。
- AI 网关偶发网络错误或路径配置错误时会表现为前端 NetworkError、后端 404/timeout。
- 文档解析兼容性是长期工作，尤其是扫描 PDF、复杂表格、多层 zip、老 Office 格式。

### 5. 邮件写作 Agent

这是用于临时替代邮件自动化的对话式 Agent。它与书院知识问答复用部分解析思路，但作为独立模块实现，避免影响知识问答稳定性。

已完成：

- 侧边栏新增 `邮件写作 Agent`。
- 页面分为：
  - `邮件写作`
  - `参考邮件库录入`
- `参考邮件库录入` 支持上传可解析参考邮件/文档，解析后固化为当前 session 的 sources 和 templates。
- `邮件写作` 支持：
  - 当前请求文档上传
  - 文本对话
  - 图片作为聊天附件输入多模态模型
  - 追问缺失信息
  - 检索参考邮件模板
  - 生成可编辑纯文本邮件草稿
  - 保存手动编辑后的 subject/body
  - 下载 DOCX
  - 清空对话，但保留参考邮件库、上传文件和最新草稿
  - 删除整个 session
- 前端已移除快速/精准模式切换，默认使用后端默认模式。
- 参考邮件库 AI 模板提取已改为并发处理，并增加超时控制，避免单文件大量模板时长时间无响应。
- 上传解析进度条已接入。
- `.msg` 和旧 `.doc` 当前明确不支持，不作为第一版范围。

主要文件：

- 后端：`apps/api/src/message-agent/`
- 前端：`apps/web/src/pages/MessageAgentPage.tsx`
- DOCX 导出：`apps/api/src/message-agent/docx-export.ts`
- 测试：`apps/api/test/messageAgent.test.ts`
- 需求文档：`docs/message-agent-backend-agent.md`、`docs/message-agent-frontend-agent.md`

当前困难：

- 用户明确要求“必须走 AI”提炼参考邮件模板，本地规则只可作为 fallback。因此解析 `邮件常用库.xlsx` 这类大文件时，瓶颈在 AI 模板提取，而不是 xlsx 读取本身。
- 参考库一旦上传，会固化到当前 session；如果删除 session，需要重新上传。
- 目前 session 存在浏览器 localStorage 中保存的 session id 和后端 `storage/message-agent/sessions` 文件快照，尚未做多用户协作隔离。
- 图片仅作为聊天附件进入多模态理解，不进入参考文档解析库。

## 本地样例材料

以下目录用于开发测试，已在 `.gitignore` 中忽略，不应提交：

- `OutstandingGraduateCheck/`：优秀毕业生原始 workbook、处理版 workbook 和证明材料文件夹。
- `ScholarshipCheck/`：奖学金奖项置信度 workbook 样例。
- `RAGMaterial/`：书院知识库样例，包括 zip 和展开后的资料。
- `MessageAgent/`：参考邮件、PDF、DOCX、XLSX 等样例。
- `storage/`：运行时数据库、任务快照、上传文件、解析结果和日志。

如果后续开发者拿不到这些本地目录，需要向项目负责人索取脱敏样例，或者自行构造同格式文件跑测试。

## 测试现状

后端已有较完整的 Vitest 覆盖：

- `apps/api/test/app.test.ts`
- `apps/api/test/scholarshipCheck.test.ts`
- `apps/api/test/awardConfidence.test.ts`
- `apps/api/test/collegeKnowledge.test.ts`
- `apps/api/test/messageAgent.test.ts`
- `apps/api/test/sqliteRepository.test.ts`
- `apps/api/test/sqliteApp.test.ts`
- 以及邮件分类/规则/处理器相关测试。

前端目前主要依赖 TypeScript typecheck 和 build，没有组件级自动化测试。

最近一次针对邮件 Agent 清空对话改动的验证命令：

```bash
pnpm.cmd --filter @harmonia/api test -- test/messageAgent.test.ts
pnpm.cmd --filter @harmonia/api typecheck
pnpm.cmd --filter @harmonia/web typecheck
```

如做交付前整体验收，建议运行：

```bash
pnpm review
git diff --check
```

## 已知困难和风险

### 1. AI 网关稳定性

当前多个模块依赖校内 OpenAI-compatible 网关。如果 base URL、模型名、key、网络环境或 HTTP 路径不正确，会出现：

- 前端 `NetworkError when attempting to fetch resource`
- 后端 404
- 模型调用 timeout
- 长时间 pending

排查顺序建议：

1. `Test-NetConnection ai-api.cuhk.edu.cn -Port 443`
2. 检查 `.env` 中 base URL 是否包含 `/v1`
3. 检查模型名是否与网关实际部署一致
4. 检查后端日志 `storage/api-dev.log`
5. 单独调用健康接口或最小 chat completion 请求

### 2. 无 embedding 的知识问答上限

知识库体量不大时，目前的词法检索方案可接受；但如果文档量扩大，或用户问法与原文差异很大，召回质量会下降。下一阶段最值得做的是接入可用 embedding 模型和向量索引。

### 3. 文档格式兼容性

现代 Office 格式较好处理，旧格式和邮件格式仍是难点：

- `.docx`、`.pptx`、`.xlsx` 可直接解析。
- `.pdf` 可抽文本，部分 PDF Portfolio 可提取内嵌 PDF。
- 扫描 PDF 需要 OCR 或视觉模型配合，目前不是完整 OCR 管线。
- `.doc`、`.ppt`、`.msg` 当前不支持。

如果必须支持 `.msg`，建议单独调研 Outlook msg parser 或先要求用户导出为 PDF/HTML/文本。

### 4. 文件系统快照适合本机，不等于生产级任务队列

材料核对、奖项置信度、知识库、Message Agent 都在 `storage/` 下保存文件和 JSON 快照。这个方案对本机服务端可行，但在多人同时使用、跨机器部署或需要审计追踪时，应升级为：

- 数据库存任务元数据
- 对象存储保存上传文件
- 后台队列管理长任务
- 更细的用户隔离和权限控制

### 5. 前端自动化测试不足

目前前端没有 Playwright 或组件测试，复杂 UI 主要靠人工验收和 typecheck。对后续高频改动模块，建议补：

- 登录后路由 smoke test
- 材料核对上传/历史记录/删除流程
- 知识问答上传/问答/清空流程
- Message Agent 参考库上传/对话/清空/下载流程

### 6. 真实业务判断仍需人工兜底

优秀毕业生材料核对和奖项置信度都涉及业务判断。AI/规则只能辅助：

- 材料核对需要保留人工编辑 `核对情况备注` 和 `详细情况`。
- 奖项置信度需要显示公式说明和可解释分项。
- 任何模型异常都不应直接转化为新的业务状态，而应写入技术错误或详情中的人工复核提示。

## 后续优先级建议

1. 稳定 AI 调用层：统一 timeout、重试、错误归因、日志 request id、前端错误提示。
2. 给知识问答接入 embedding：保留快速词法召回作为 fallback，新增向量召回和混合排序。
3. 把长任务状态数据库化：优先处理材料核对、奖项置信度和 Message Agent 模板提取。
4. 强化文档解析：扫描 PDF OCR、复杂 Excel sheet、PPT 表格、PDF Portfolio、多层 zip。
5. 补前端 e2e：至少覆盖四个当前核心新增模块。
6. 明确部署方案：如果要外网访问本机服务，建议使用反向代理、HTTPS、固定域名、强密码、持久化备份和访问控制，不要直接裸露开发服务器。

## 给后续开发者的阅读顺序

建议按以下顺序接手：

1. 先读本 README，跑通 `pnpm dev`。
2. 再读 `apps/api/src/app.ts` 和 `apps/web/src/App.tsx`，理解路由注册。
3. 看 `packages/shared/src/index.ts`，确认前后端类型契约。
4. 按负责模块阅读对应文档：
   - 邮箱工作台：`docs/backend-agent.md`、`docs/frontend-agent.md`
   - 优秀毕业生材料核对/奖项置信度：`docs/scholarship-check-backend-agent.md`、`docs/scholarship-check-frontend-agent.md`
   - 书院知识问答：`docs/college-knowledge-backend-agent.md`、`docs/college-knowledge-frontend-agent.md`
   - 邮件写作 Agent：`docs/message-agent-backend-agent.md`、`docs/message-agent-frontend-agent.md`
5. 最后跑相关测试，再做改动。

## 开发约定

- 前后端共享的状态、响应类型、枚举先改 `packages/shared/src/index.ts`。
- 前端不要做文件解析、AI 调用、DOCX 生成等后端职责。
- 后端不要写 UI 展示逻辑，但要返回足够结构化的状态、错误和进度。
- 不要提交 `.env`、`storage/` 和本地样例材料。
- 不要在代码或文档中提交真实 API key。
- 对长任务改动必须考虑暂停、取消、删除、历史记录和页面切换后的后台继续运行。
- 对 AI 输出改动必须考虑 fallback、超时和人工复核。
