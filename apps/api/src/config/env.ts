import dotenv from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const envCandidates = [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")];
const envPath = envCandidates.find((candidate) => existsSync(candidate));
dotenv.config(envPath ? { path: envPath } : undefined);

const envBoolean = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "n", "off", ""].includes(normalized)) return false;
  return value;
}, z.boolean());

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  WEB_ORIGIN: z.string().default("http://localhost:5173"),
  SESSION_SECRET: z.string().min(24).default("dev-session-secret-change-before-production"),
  APP_TIMEZONE: z.string().default("Asia/Shanghai"),
  DATABASE_URL: z.string().default("postgres://harmonia:harmonia@localhost:5432/harmonia"),
  ADMIN_EMAIL: z.string().email().default("admin@example.edu.cn"),
  ADMIN_PASSWORD: z.string().min(8).default("ChangeMe123!"),
  GRAPH_TENANT_ID: z.string().default("common"),
  GRAPH_CLIENT_ID: z.string().default(""),
  GRAPH_TOKEN_CACHE_PATH: z.string().default("storage/msal-cache.json"),
  GRAPH_MAILBOX_ADDRESS: z.string().default(""),
  GRAPH_SYNC_ENABLED: envBoolean.default(false),
  GRAPH_SYNC_INTERVAL_SECONDS: z.coerce.number().int().positive().default(120),
  MAIL_SENDING_ENABLED: envBoolean.default(false),
  OPENAI_API_KEY: z.string().default(""),
  OPENAI_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  OPENAI_TEXT_API_KEY: z.string().default(""),
  OPENAI_TEXT_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  OPENAI_TEXT_MODEL: z.string().default("gpt-4.1-mini"),
  OPENAI_VISION_API_KEY: z.string().default(""),
  OPENAI_VISION_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  OPENAI_VISION_MODEL: z.string().default("gpt-4.1-mini"),
  AI_ENABLED: envBoolean.default(false),
  ATTACHMENT_STORAGE_DIR: z.string().default("storage/attachments")
});

export type Env = z.infer<typeof envSchema>;

export const env: Env = envSchema.parse(process.env);
