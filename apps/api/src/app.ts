import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  mailCategories,
  processingStatuses,
  type AppSettings,
  type BusinessOwnerConfig,
  type DraftStatus,
  type KnowledgeEntry
} from "@harmonia/shared";
import { clearSessionCookie, createSessionToken, readSession, requireAuth, setSessionCookie, verifyPassword } from "./auth/session.js";
import { processMessage } from "./business/processor.js";
import type { AiClient } from "./ai/client.js";
import type { AppRepository } from "./db/repository.js";
import type { Env } from "./config/env.js";
import type { GraphMailClient } from "./graph/client.js";
import type { OutboundMailer } from "./mail/outbound.js";
import { syncMailbox } from "./worker/sync.js";

export type BuildAppOptions = {
  env: Env;
  repo: AppRepository;
  ai: AiClient;
  mailer: OutboundMailer;
  graph: GraphMailClient;
  attachmentRoot: string;
};

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

const messageQuerySchema = z.object({
  category: z.enum(mailCategories).optional(),
  status: z.enum(processingStatuses).optional(),
  needsReview: z
    .string()
    .optional()
    .transform((value) => (value === undefined || value === "" ? undefined : value === "true")),
  hasAttachments: z
    .string()
    .optional()
    .transform((value) => (value === undefined || value === "" ? undefined : value === "true")),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0)
});

const settingsSchema = z.object({
  mailboxAddress: z.string(),
  ownerEmails: z.record(z.string(), z.string()).transform((value) => value as BusinessOwnerConfig),
  defaultManualEmail: z.string(),
  roomAutoApproveEnabled: z.boolean(),
  knowledgeBaseEnabled: z.boolean(),
  mailSyncEnabled: z.boolean(),
  roomRules: z.object({
    allowedRooms: z.array(z.string()),
    maxParticipants: z.number().int().positive(),
    allowedPurposes: z.array(z.string())
  })
});

const knowledgeSchema = z.object({
  id: z.string().optional(),
  category: z.enum(["party_consultation", "admission_consultation"]),
  question: z.string().min(1),
  answer: z.string().min(1),
  enabled: z.boolean().default(true)
});

export async function buildApp(options: BuildAppOptions) {
  const app = Fastify({ logger: options.env.NODE_ENV !== "test" });
  await app.register(cookie);
  await app.register(cors, {
    origin: options.env.WEB_ORIGIN,
    credentials: true
  });

  const authGuard = requireAuth(options.repo, options.env.SESSION_SECRET);
  app.addHook("preHandler", async (request, reply) => {
    const publicRoute =
      request.url === "/health" ||
      (request.method === "POST" && request.url === "/auth/login") ||
      request.url === "/auth/me";
    if (publicRoute) return;
    await authGuard(request, reply);
  });

  app.get("/health", async () => ({ ok: true }));

  app.post("/auth/login", async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const user = await options.repo.findUserByEmail(body.email);
    if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
      return reply.code(401).send({ error: "INVALID_CREDENTIALS" });
    }
    const token = createSessionToken(user, options.env.SESSION_SECRET);
    setSessionCookie(reply, token);
    return { user: { id: user.id, email: user.email, role: user.role } };
  });

  app.post("/auth/logout", async (_request, reply) => {
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get("/auth/me", async (request) => {
    const session = readSession(request, options.env.SESSION_SECRET);
    return { user: session ? { id: session.sub, email: session.email, role: session.role } : null };
  });

  app.get("/dashboard", async () => options.repo.dashboard(new Date().toISOString()));

  app.get("/messages", async (request) => {
    const query = messageQuerySchema.parse(request.query);
    return options.repo.listMessages({
      ...(query.category ? { category: query.category } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.needsReview !== undefined ? { needsReview: query.needsReview } : {}),
      ...(query.hasAttachments !== undefined ? { hasAttachments: query.hasAttachments } : {}),
      ...(query.from ? { from: query.from } : {}),
      ...(query.to ? { to: query.to } : {}),
      limit: query.limit,
      offset: query.offset
    });
  });

  app.get("/messages/:id", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const message = await options.repo.getMessage(params.id);
    if (!message) return reply.code(404).send({ error: "MESSAGE_NOT_FOUND" });
    const [attachments, draft, audits] = await Promise.all([
      options.repo.listAttachments(message.id),
      options.repo.getDraftForMessage(message.id),
      options.repo.listAuditLogs(message.id)
    ]);
    return { message, attachments, draft, audits };
  });

  app.post("/messages/:id/process", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const message = await options.repo.getMessage(params.id);
    if (!message) return reply.code(404).send({ error: "MESSAGE_NOT_FOUND" });
    const processed = await processMessage(options, message);
    return { message: processed };
  });

  app.get("/drafts", async (request) => {
    const query = z.object({ status: z.string().optional() }).parse(request.query);
    const status = query.status as DraftStatus | undefined;
    const items = await options.repo.listDrafts(status);
    return { items, total: items.length };
  });

  app.patch("/drafts/:id", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({ body: z.string().min(1) }).parse(request.body);
    const draft = await options.repo.getDraft(params.id);
    if (!draft) return reply.code(404).send({ error: "DRAFT_NOT_FOUND" });
    const updated = await options.repo.updateDraft(params.id, { body: body.body, status: "saved" });
    await options.repo.addAudit({
      messageId: draft.messageId,
      actor: request.user?.email ?? "unknown",
      action: "draft_saved",
      detail: { draftId: draft.id }
    });
    return { draft: updated };
  });

  app.post("/drafts/:id/send", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const draft = await options.repo.getDraft(params.id);
    if (!draft) return reply.code(404).send({ error: "DRAFT_NOT_FOUND" });
    const message = await options.repo.getMessage(draft.messageId);
    if (!message) return reply.code(404).send({ error: "MESSAGE_NOT_FOUND" });
    const settings = await options.repo.getSettings();
    const result = await options.mailer.send({
      mailboxAddress: settings.mailboxAddress,
      to: [draft.toEmail],
      cc: draft.ccEmails,
      subject: draft.subject,
      bodyText: draft.body
    });
    await options.repo.createSendLog({
      messageId: message.id,
      draftId: draft.id,
      kind: "reply",
      toEmail: draft.toEmail,
      subject: draft.subject,
      status: result.status,
      error: result.error,
      sentAt: result.sentAt
    });
    if (result.status !== "sent") {
      return reply.code(409).send({ error: "MAIL_NOT_SENT", result });
    }
    const sentDraft = await options.repo.updateDraft(draft.id, { status: "sent", sentAt: result.sentAt });
    const updatedMessage = await options.repo.updateMessageProcessing(message.id, {
      status: "completed",
      needsReview: false,
      processedAt: new Date().toISOString()
    });
    await options.repo.addAudit({
      messageId: message.id,
      actor: request.user?.email ?? "unknown",
      action: "draft_sent",
      detail: { draftId: draft.id, to: draft.toEmail }
    });
    return { draft: sentDraft, message: updatedMessage };
  });

  app.post("/drafts/:id/reject", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const draft = await options.repo.getDraft(params.id);
    if (!draft) return reply.code(404).send({ error: "DRAFT_NOT_FOUND" });
    const updated = await options.repo.updateDraft(draft.id, { status: "rejected" });
    await options.repo.updateMessageProcessing(draft.messageId, {
      status: "manual_required",
      needsReview: true,
      recommendation: "回复草稿已被拒绝，请人工处理"
    });
    await options.repo.addAudit({
      messageId: draft.messageId,
      actor: request.user?.email ?? "unknown",
      action: "draft_rejected",
      detail: { draftId: draft.id }
    });
    return { draft: updated };
  });

  app.post("/drafts/:id/manual", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const draft = await options.repo.getDraft(params.id);
    if (!draft) return reply.code(404).send({ error: "DRAFT_NOT_FOUND" });
    const updated = await options.repo.updateDraft(draft.id, { status: "manual_required" });
    await options.repo.updateMessageProcessing(draft.messageId, {
      status: "manual_required",
      needsReview: true,
      recommendation: "已标记为人工处理"
    });
    await options.repo.addAudit({
      messageId: draft.messageId,
      actor: request.user?.email ?? "unknown",
      action: "manual_required",
      detail: { draftId: draft.id }
    });
    return { draft: updated };
  });

  app.post("/drafts/:id/no-reply", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const draft = await options.repo.getDraft(params.id);
    if (!draft) return reply.code(404).send({ error: "DRAFT_NOT_FOUND" });
    const updated = await options.repo.updateDraft(draft.id, { status: "no_reply_needed" });
    await options.repo.updateMessageProcessing(draft.messageId, { status: "completed", needsReview: false });
    await options.repo.addAudit({
      messageId: draft.messageId,
      actor: request.user?.email ?? "unknown",
      action: "no_reply_needed",
      detail: { draftId: draft.id }
    });
    return { draft: updated };
  });

  app.get("/forward-records", async () => {
    const items = await options.repo.listForwardRecords();
    return { items, total: items.length };
  });

  app.get("/settings", async () => options.repo.getSettings());

  app.patch("/settings", async (request) => {
    const body = settingsSchema.parse(request.body) as AppSettings;
    const settings = await options.repo.saveSettings(body);
    await options.repo.addAudit({
      messageId: null,
      actor: request.user?.email ?? "unknown",
      action: "settings_updated",
      detail: { mailboxAddress: settings.mailboxAddress }
    });
    return settings;
  });

  app.get("/knowledge-base", async (request) => {
    const query = z.object({ category: z.enum(["party_consultation", "admission_consultation"]).optional() }).parse(request.query);
    const items = await options.repo.listKnowledgeEntries(query.category);
    return { items, total: items.length };
  });

  app.post("/knowledge-base", async (request) => {
    const body = knowledgeSchema.parse(request.body);
    const entry: Omit<KnowledgeEntry, "createdAt" | "updatedAt"> = {
      id: body.id ?? randomUUID(),
      category: body.category,
      question: body.question,
      answer: body.answer,
      enabled: body.enabled
    };
    const saved = await options.repo.upsertKnowledgeEntry(entry);
    await options.repo.addAudit({
      messageId: null,
      actor: request.user?.email ?? "unknown",
      action: "knowledge_entry_saved",
      detail: { id: saved.id, category: saved.category }
    });
    return { entry: saved };
  });

  app.post("/sync/run", async () => {
    const result = await syncMailbox({
      repo: options.repo,
      graph: options.graph,
      ai: options.ai,
      mailer: options.mailer,
      attachmentRoot: options.attachmentRoot
    });
    return result;
  });

  return app;
}
