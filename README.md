# Harmonia Auto Workflow

学院 Outlook 公共邮箱自动化系统初版工程。系统提供邮件同步、分类、附件下载、业务概要、AI 回复草稿、人工审核、功能房自动批准、负责人通知和审计记录。

## Quick Start

```bash
cp .env.example .env
pnpm install
docker compose up -d postgres
pnpm --filter @harmonia/api dev
pnpm --filter @harmonia/web dev
```

- 前端: http://localhost:5173
- 后端: http://localhost:4000/health
- 默认管理员来自 `.env` 中的 `ADMIN_EMAIL` 和 `ADMIN_PASSWORD`

## Outlook 服务账号接入

1. 在 Microsoft Entra 注册公共客户端应用，允许 device code flow。
2. 将 `GRAPH_TENANT_ID`、`GRAPH_CLIENT_ID`、`GRAPH_MAILBOX_ADDRESS` 写入 `.env`。
3. 确保服务账号对公共邮箱有读取和发送权限。
4. 执行 `pnpm --filter @harmonia/api graph:login`，按终端提示完成设备码登录。
5. 设置 `GRAPH_SYNC_ENABLED=true` 并重启 API。

## AI/OCR 接入

填写文本和图像模型的 OpenAI-compatible 配置，再将 `AI_ENABLED=true`。当前模板默认文本走 DeepSeek `https://api.deepseek.com` + `deepseek-v4-pro`，图像/OCR 走阿里云百炼 DashScope `https://dashscope.aliyuncs.com/compatible-mode/v1` + `qwen3.7-plus`。

```bash
OPENAI_TEXT_API_KEY=...
OPENAI_TEXT_BASE_URL=https://api.deepseek.com
OPENAI_TEXT_MODEL=deepseek-v4-pro
OPENAI_VISION_API_KEY=...
OPENAI_VISION_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
OPENAI_VISION_MODEL=qwen3.7-plus
AI_ENABLED=true
```

未开启时系统会使用规则和占位结果跑通流程。

## Review Gate

```bash
pnpm review
```

该命令会运行 lint、typecheck、test 和 build。
