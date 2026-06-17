# Harmonia Auto Workflow

学院 Outlook 公共邮箱自动化工作流系统。系统提供邮件同步、分类、附件下载、业务概要、AI 回复草稿、人工审核、功能房自动审批、负责人通知和审计记录。

## 本机快速启动

当前默认后端数据库为 SQLite 文件，不需要 Docker 或本机 PostgreSQL。

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
- 默认管理员来自 `.env` 中的 `ADMIN_EMAIL` / `ADMIN_PASSWORD`，额外管理员可通过 `ADMIN_USERS` 配置
- 默认 SQLite 数据库文件: `storage/harmonia.sqlite`

## 数据库配置

默认本机模式：

```bash
DB_DRIVER=sqlite
SQLITE_DB_PATH=storage/harmonia.sqlite
```

如需继续使用 PostgreSQL：

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

填写文本和图像模型的 OpenAI-compatible 配置，再设置 `AI_ENABLED=true`。当前示例默认文本走 DeepSeek，图像 OCR 走阿里云百炼 DashScope。

```bash
OPENAI_TEXT_API_KEY=...
OPENAI_TEXT_BASE_URL=https://api.deepseek.com
OPENAI_TEXT_MODEL=deepseek-v4-pro
OPENAI_VISION_API_KEY=...
OPENAI_VISION_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
OPENAI_VISION_MODEL=qwen3.7-plus
SCHOLARSHIP_CHECK_AI_API_KEY=...
SCHOLARSHIP_CHECK_AI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
SCHOLARSHIP_CHECK_AI_MODEL=qwen3.7-plus
AI_ENABLED=true
```

奖学金材料核对可以通过 `SCHOLARSHIP_CHECK_AI_*` 单独配置模型；PDF 证明材料会逐页全量渲染并提交审核。未开启 AI 时，系统会使用规则和占位结果跑通流程。

## Review Gate

```bash
pnpm review
```

该命令会运行 lint、typecheck、test 和 build。
