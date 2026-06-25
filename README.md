# Harmonia Auto Workflow

学院公共邮箱与书院事务自动化工作流系统。项目提供 Outlook 公共邮箱同步、邮件分类与处理、AI 回复草稿、人工审核、负责人通知、独立奖学金/优秀毕业生材料核对、奖项置信度计算，以及书院知识问答。

## 主要功能

- 邮件工作台：同步公共邮箱邮件，按业务类型分类，生成概要、建议、回复草稿和审计记录。
- 回复审核：人工编辑、发送、拒绝或标记无需回复，终态草稿会被后端保护避免重复发送。
- 功能房流程：根据配置的地点、用途和人数规则执行自动审批或人工流转。
- 优秀毕业生材料核对：上传系统导出的 `.xlsx` 和申请人证明材料文件夹，生成带 `核对情况备注` 与 `详细情况` 的处理版 Excel。
- 奖项置信度：上传奖学金个人奖项申请资料 `.xlsx`，计算第一/第二奖项置信度并导出结果 Excel。
- 书院知识问答：上传书院制度、通知、FAQ 等文档，系统解析为可检索知识库，并基于来源文档回答问题。
- 运行配置：支持本地管理员、邮件同步开关、功能房规则、知识库开关，以及奖学金/置信度模型选择。

## 本机快速启动

默认后端数据库为 SQLite 文件，不需要 Docker 或本机 PostgreSQL。

前置要求：

- Node.js 24.x
- pnpm 10.x，可通过 Node.js 自带 Corepack 启用

```bash
cp .env.example .env
corepack enable
corepack prepare pnpm@10.11.0 --activate
pnpm install
pnpm --filter @harmonia/api dev
pnpm --filter @harmonia/web dev
```

- 前端: http://localhost:5173
- 后端健康检查: http://localhost:4000/health
- 默认管理员来自 `.env` 中的 `ADMIN_EMAIL` / `ADMIN_PASSWORD`
- 额外管理员可通过 `ADMIN_USERS` 配置
- 默认 SQLite 数据库文件: `storage/harmonia.sqlite`

## 数据库配置

默认本机模式：

```bash
DB_DRIVER=sqlite
SQLITE_DB_PATH=storage/harmonia.sqlite
```

如需使用 PostgreSQL：

```bash
DB_DRIVER=postgres
DATABASE_URL=postgres://harmonia:harmonia@localhost:5433/harmonia
```

Docker Compose 路径仍保留，并会显式使用 PostgreSQL：

```bash
docker compose up --build
```

## Outlook 服务账号接入

1. 在 Microsoft Entra 注册公共客户端应用，并允许 device code flow。
2. 将 `GRAPH_TENANT_ID`、`GRAPH_CLIENT_ID`、`GRAPH_MAILBOX_ADDRESS` 写入 `.env`。
3. 确保服务账号对公共邮箱有读取和发送权限。
4. 执行 `pnpm --filter @harmonia/api graph:login`，按终端提示完成设备码登录。
5. 设置 `GRAPH_SYNC_ENABLED=true` 并重启 API。

## AI/OCR 接入

填写 OpenAI-compatible 配置后设置 `AI_ENABLED=true`。当前 `.env.example` 默认使用中大兼容网关与 `qwen3-5-397b-a17b`，也可以按部署环境替换为其他兼容模型。

```bash
OPENAI_API_KEY=...
OPENAI_BASE_URL=https://ai-api.cuhk.edu.cn/v1
OPENAI_TEXT_API_KEY=...
OPENAI_TEXT_BASE_URL=https://ai-api.cuhk.edu.cn/v1
OPENAI_TEXT_MODEL=qwen3-5-397b-a17b
OPENAI_VISION_API_KEY=...
OPENAI_VISION_BASE_URL=https://ai-api.cuhk.edu.cn/v1
OPENAI_VISION_MODEL=qwen3-5-397b-a17b

SCHOLARSHIP_CHECK_AI_API_KEY=...
SCHOLARSHIP_CHECK_AI_BASE_URL=https://ai-api.cuhk.edu.cn/v1
SCHOLARSHIP_CHECK_AI_MODEL=qwen3-5-397b-a17b
SCHOLARSHIP_CHECK_AI_IMAGES_PER_REQUEST=4
SCHOLARSHIP_CHECK_AI_PDF_IMAGE_WIDTH=1600
AI_ENABLED=true
```

奖学金材料核对与奖项置信度可通过 `SCHOLARSHIP_CHECK_AI_*` 单独配置。PDF 证明材料会逐页全量渲染并分批提交审核，`SCHOLARSHIP_CHECK_AI_IMAGES_PER_REQUEST` 只控制每次模型调用的图片批量，不会截断 PDF 页数。未开启 AI 时，系统会使用规则和占位结果跑通流程。

配置页可在 `qwen3-5-397b-a17b` 与 `gemma-4-31B` 之间选择后续奖学金材料核对和奖项置信度任务使用的模型。

## 书院知识问答

入口在侧边栏 `书院知识问答`。支持直接上传文件、文件夹上传和 zip 上传；当前解析格式包括 `.docx`、`.pptx`、`.xlsx`、`.xls`、`.pdf`、`.md`、`.txt`、`.csv`，旧版 `.doc` / `.ppt` 会记录为不支持，除非后续配置转换器。

知识问答模块会保存原始文件、抽取 Markdown、生成 source-aware chunks，并通过词法检索、模型重排和来源约束回答问题。回答会返回引用来源，包括文件名、页码、slide、sheet row 或 chunk locator。

## 本地私有材料

`.gitignore` 已忽略以下本地材料和运行产物，提交前不要强行加入：

- `.env`
- `storage/`
- `ScholarshipCheck/`
- `OutstandingGraduateCheck/`
- `RAGMaterial/`
- `node_modules/`、`dist/`、`dist-types/`

## Review Gate

```bash
pnpm review
```

该命令会运行 lint、typecheck、test 和 build。当前提交前也建议执行：

```bash
git diff --check
```
