import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { NoopAiClient } from "../src/ai/client.js";
import { hashPassword } from "../src/auth/session.js";
import { SQLiteRepository } from "../src/db/sqlite.js";
import type { Env } from "../src/config/env.js";
import type { GraphMailClient } from "../src/graph/client.js";
import type { OutboundMailer } from "../src/mail/outbound.js";

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

function envFor(dbPath: string): Env {
  return {
    NODE_ENV: "test",
    PORT: 4000,
    WEB_ORIGIN: "http://localhost:5173",
    SESSION_SECRET: "test-session-secret-with-enough-length",
    APP_TIMEZONE: "Asia/Shanghai",
    DB_DRIVER: "sqlite",
    SQLITE_DB_PATH: dbPath,
    DATABASE_URL: "postgres://test",
    ADMIN_EMAIL: "admin@example.edu.cn",
    ADMIN_PASSWORD: "ChangeMe123!",
    ADMIN_USERS: [],
    GRAPH_TENANT_ID: "common",
    GRAPH_CLIENT_ID: "",
    GRAPH_TOKEN_CACHE_PATH: "storage/msal-cache.json",
    GRAPH_MAILBOX_ADDRESS: "public@example.edu.cn",
    GRAPH_SYNC_ENABLED: false,
    GRAPH_SYNC_INTERVAL_SECONDS: 120,
    MAIL_SENDING_ENABLED: false,
    OPENAI_API_KEY: "",
    OPENAI_BASE_URL: "https://ai-api.cuhk.edu.cn/v1",
    OPENAI_TEXT_API_KEY: "",
    OPENAI_TEXT_BASE_URL: "https://ai-api.cuhk.edu.cn/v1",
    OPENAI_TEXT_MODEL: "qwen3-5-397b-a17b",
    OPENAI_VISION_API_KEY: "",
    OPENAI_VISION_BASE_URL: "https://ai-api.cuhk.edu.cn/v1",
    OPENAI_VISION_MODEL: "qwen3-5-397b-a17b",
    SCHOLARSHIP_CHECK_AI_API_KEY: "",
    SCHOLARSHIP_CHECK_AI_BASE_URL: "https://ai-api.cuhk.edu.cn/v1",
    SCHOLARSHIP_CHECK_AI_MODEL: "qwen3-5-397b-a17b",
    SCHOLARSHIP_CHECK_AI_IMAGES_PER_REQUEST: 4,
    SCHOLARSHIP_CHECK_AI_PDF_IMAGE_WIDTH: 1600,
    AI_ENABLED: false,
    ATTACHMENT_STORAGE_DIR: "storage/attachments"
  };
}

describe("app with SQLiteRepository", () => {
  it("logs in and persists settings across repository restarts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "harmonia-sqlite-app-"));
    const dbPath = join(dir, "harmonia.sqlite");
    const env = envFor(dbPath);
    try {
      const repo = await SQLiteRepository.open(dbPath, env.GRAPH_MAILBOX_ADDRESS);
      await repo.migrate();
      await repo.ensureAdminUser(env.ADMIN_EMAIL, await hashPassword(env.ADMIN_PASSWORD));
      const app = await buildApp({ env, repo, ai: new NoopAiClient(), mailer, graph, attachmentRoot: env.ATTACHMENT_STORAGE_DIR });

      const health = await app.inject({ method: "GET", url: "/health" });
      expect(health.statusCode).toBe(200);

      const login = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD }
      });
      expect(login.statusCode).toBe(200);
      const cookie = String(login.headers["set-cookie"]);

      const currentSettings = await app.inject({ method: "GET", url: "/settings", headers: { cookie } });
      const updatedSettings = {
        ...currentSettings.json(),
        defaultManualEmail: "manual@example.edu.cn",
        mailSyncEnabled: true
      };
      const save = await app.inject({
        method: "PATCH",
        url: "/settings",
        headers: { cookie },
        payload: updatedSettings
      });
      expect(save.statusCode).toBe(200);
      await app.close();
      await repo.close();

      const reopenedRepo = await SQLiteRepository.open(dbPath, env.GRAPH_MAILBOX_ADDRESS);
      await reopenedRepo.migrate();
      const reopenedApp = await buildApp({
        env,
        repo: reopenedRepo,
        ai: new NoopAiClient(),
        mailer,
        graph,
        attachmentRoot: env.ATTACHMENT_STORAGE_DIR
      });
      const secondLogin = await reopenedApp.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD }
      });
      expect(secondLogin.statusCode).toBe(200);
      const settings = await reopenedApp.inject({
        method: "GET",
        url: "/settings",
        headers: { cookie: String(secondLogin.headers["set-cookie"]) }
      });
      expect(settings.json()).toMatchObject({
        defaultManualEmail: "manual@example.edu.cn",
        mailSyncEnabled: true
      });
      await reopenedApp.close();
      await reopenedRepo.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
