import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/auth/session.js";
import { NoopAiClient } from "../src/ai/client.js";
import { InMemoryRepository } from "../src/db/memory.js";
import type { GraphMailClient } from "../src/graph/client.js";
import type { OutboundMailer } from "../src/mail/outbound.js";

const env = {
  NODE_ENV: "test",
  PORT: 4000,
  WEB_ORIGIN: "http://localhost:5173",
  SESSION_SECRET: "test-session-secret-with-enough-length",
  APP_TIMEZONE: "Asia/Shanghai",
  DATABASE_URL: "postgres://test",
  ADMIN_EMAIL: "admin@example.edu.cn",
  ADMIN_PASSWORD: "ChangeMe123!",
  GRAPH_TENANT_ID: "common",
  GRAPH_CLIENT_ID: "",
  GRAPH_TOKEN_CACHE_PATH: "storage/msal-cache.json",
  GRAPH_MAILBOX_ADDRESS: "public@example.edu.cn",
  GRAPH_SYNC_ENABLED: false,
  GRAPH_SYNC_INTERVAL_SECONDS: 120,
  MAIL_SENDING_ENABLED: false,
  OPENAI_API_KEY: "",
  OPENAI_BASE_URL: "https://api.openai.com/v1",
  OPENAI_TEXT_API_KEY: "",
  OPENAI_TEXT_BASE_URL: "https://api.deepseek.com",
  OPENAI_TEXT_MODEL: "gpt-4.1-mini",
  OPENAI_VISION_API_KEY: "",
  OPENAI_VISION_BASE_URL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  OPENAI_VISION_MODEL: "gpt-4.1-mini",
  AI_ENABLED: false,
  ATTACHMENT_STORAGE_DIR: "storage/attachments"
} as const;

const graph: GraphMailClient = {
  async listInboxDelta() {
    return { messages: [], rawIds: new Map(), deltaLink: null };
  },
  async listAttachments() {
    return [];
  },
  async downloadAttachment() {
    return Buffer.from("");
  },
  async sendMail() {
    return;
  }
};

const mailer: OutboundMailer = {
  async send() {
    return { status: "skipped", error: "disabled", sentAt: null };
  }
};

describe("app auth", () => {
  it("protects backend pages and accepts local password login", async () => {
    const repo = new InMemoryRepository("public@example.edu.cn");
    await repo.ensureAdminUser("admin@example.edu.cn", await hashPassword("ChangeMe123!"));
    const app = await buildApp({ env, repo, ai: new NoopAiClient(), mailer, graph, attachmentRoot: "storage/attachments" });

    const denied = await app.inject({ method: "GET", url: "/dashboard" });
    expect(denied.statusCode).toBe(401);

    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "admin@example.edu.cn", password: "ChangeMe123!" }
    });
    expect(login.statusCode).toBe(200);
    const cookie = login.headers["set-cookie"];
    expect(cookie).toBeTruthy();

    const dashboard = await app.inject({ method: "GET", url: "/dashboard", headers: { cookie: String(cookie) } });
    expect(dashboard.statusCode).toBe(200);
    await app.close();
  });
});
