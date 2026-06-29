import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { messageAgentChatModes, type MessageAgentFileRole } from "@harmonia/shared";
import type { AiClient } from "../ai/client.js";
import type { Env } from "../config/env.js";
import {
  MessageAgentService,
  cleanupMessageAgentTemp,
  messageAgentTempUploadName,
  type MessageAgentImageFile,
  type MessageAgentUploadedFile
} from "./service.js";
import { contentTypeFromName, messageAgentStorageRoot } from "./storage.js";

const paramsSchema = z.object({ id: z.string().uuid() });
const fileRoleSchema = z.enum(["reference", "request", "attachment"]).default("reference");
const chatJsonSchema = z.object({
  message: z.string().min(1).max(8000),
  mode: z.enum(messageAgentChatModes).default("fast")
});
const patchDraftSchema = z.object({
  subject: z.string().min(1).optional(),
  body: z.string().min(1).optional()
});
const maxMessageAgentFilesPerUpload = 200;
const maxMessageAgentChatImages = 8;
const maxMessageAgentChatImageBytes = 10 * 1024 * 1024;
const chatImageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp"]);

type MultipartPart =
  | {
      type: "file";
      fieldname: string;
      filename: string;
      mimetype: string;
      file: NodeJS.ReadableStream;
    }
  | {
      type: "field";
      fieldname: string;
      value: unknown;
    };

export async function registerMessageAgentRoutes(
  app: FastifyInstance,
  options: {
    ai: AiClient;
    env: Pick<Env, "NODE_ENV">;
    storageRoot?: string;
  }
) {
  const serviceStorageRoot = options.storageRoot ?? (options.env.NODE_ENV === "test" ? join(tmpdir(), "harmonia-message-agent", randomUUID()) : undefined);
  const service = new MessageAgentService(options.ai, messageAgentStorageRoot(serviceStorageRoot));

  app.post("/message-agent/sessions", async () => ({ session: await service.createSession() }));

  app.get("/message-agent/sessions/:id", async (request, reply) => {
    const params = paramsSchema.parse(request.params);
    const detail = await service.getSession(params.id);
    if (!detail) return reply.code(404).send({ error: "MESSAGE_AGENT_SESSION_NOT_FOUND" });
    return detail;
  });

  app.post("/message-agent/sessions/:id/files", async (request, reply) => {
    const params = paramsSchema.parse(request.params);
    const tempDir = join(messageAgentStorageRoot(serviceStorageRoot), "tmp", randomUUID());
    await mkdir(tempDir, { recursive: true });
    const tempPaths = [tempDir];
    const files: MessageAgentUploadedFile[] = [];
    let role: MessageAgentFileRole = "reference";
    let relativePaths: string[] = [];
    try {
      let fileIndex = 0;
      for await (const part of request.parts() as AsyncIterable<MultipartPart>) {
        if (part.type === "file") {
          if (fileIndex >= maxMessageAgentFilesPerUpload) throw new Error("MESSAGE_AGENT_TOO_MANY_FILES");
          const tempPath = join(tempDir, messageAgentTempUploadName(part.filename || part.fieldname, fileIndex));
          await pipeline(part.file, createWriteStream(tempPath));
          tempPaths.push(tempPath);
          files.push({
            tempPath,
            fileName: part.filename || part.fieldname,
            contentType: contentTypeFromName(part.filename || part.fieldname, part.mimetype),
            relativePath: null
          });
          fileIndex += 1;
        } else if (part.fieldname === "fileRole") {
          role = fileRoleSchema.parse(String(part.value || "reference"));
        } else if (part.fieldname === "relativePaths") {
          relativePaths = parseRelativePaths(part.value);
        }
      }
      if (files.length === 0) return reply.code(400).send({ error: "MESSAGE_AGENT_FILES_REQUIRED" });
      const result = await service.uploadFiles(
        params.id,
        files.map((file, index) => ({ ...file, relativePath: relativePaths[index] ?? file.fileName })),
        role
      );
      if (!result) return reply.code(404).send({ error: "MESSAGE_AGENT_SESSION_NOT_FOUND" });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "MESSAGE_AGENT_UPLOAD_FAILED";
      return reply.code(400).send({ error: message });
    } finally {
      await cleanupMessageAgentTemp(tempPaths);
    }
  });

  app.post("/message-agent/sessions/:id/chat", async (request, reply) => {
    const params = paramsSchema.parse(request.params);
    if (isMultipartRequest(request)) return handleMultipartChat(request, reply, service, params.id, serviceStorageRoot);
    const body = chatJsonSchema.parse(request.body);
    const response = await service.chat(params.id, { message: body.message, mode: body.mode, images: [] });
    if (!response) return reply.code(404).send({ error: "MESSAGE_AGENT_SESSION_NOT_FOUND" });
    return response;
  });

  app.delete("/message-agent/sessions/:id/messages", async (request, reply) => {
    const params = paramsSchema.parse(request.params);
    const detail = await service.clearChat(params.id);
    if (!detail) return reply.code(404).send({ error: "MESSAGE_AGENT_SESSION_NOT_FOUND" });
    return detail;
  });

  app.patch("/message-agent/sessions/:id/draft", async (request, reply) => {
    const params = paramsSchema.parse(request.params);
    const body = patchDraftSchema.parse(request.body);
    const patch: { subject?: string; body?: string } = {};
    if (body.subject !== undefined) patch.subject = body.subject;
    if (body.body !== undefined) patch.body = body.body;
    const draft = await service.patchDraft(params.id, patch);
    if (!draft) return reply.code(404).send({ error: "MESSAGE_AGENT_DRAFT_NOT_FOUND" });
    return { draft };
  });

  app.get("/message-agent/sessions/:id/draft.docx", async (request, reply) => {
    const params = paramsSchema.parse(request.params);
    const result = await service.draftDocx(params.id);
    if (!result) return reply.code(404).send({ error: "MESSAGE_AGENT_DRAFT_NOT_FOUND" });
    return reply
      .header("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
      .header("Content-Disposition", `attachment; filename="${encodeURIComponent(result.fileName)}"`)
      .send(result.buffer);
  });

  app.delete("/message-agent/sessions/:id", async (request, reply) => {
    const params = paramsSchema.parse(request.params);
    const deleted = await service.deleteSession(params.id);
    if (!deleted) return reply.code(404).send({ error: "MESSAGE_AGENT_SESSION_NOT_FOUND" });
    return { ok: true };
  });
}

async function handleMultipartChat(
  request: FastifyRequest,
  reply: FastifyReply,
  service: MessageAgentService,
  sessionId: string,
  storageRoot: string | undefined
) {
  const tempDir = join(messageAgentStorageRoot(storageRoot), "tmp", randomUUID());
  await mkdir(tempDir, { recursive: true });
  const tempPaths = [tempDir];
  const images: MessageAgentImageFile[] = [];
  let message = "";
  let mode: "fast" | "precise" = "fast";
  try {
    let fileIndex = 0;
    for await (const part of request.parts() as AsyncIterable<MultipartPart>) {
      if (part.type === "file") {
        if (images.length >= maxMessageAgentChatImages) throw new Error("MESSAGE_AGENT_TOO_MANY_IMAGES");
        const fileName = part.filename || part.fieldname;
        const contentType = contentTypeFromName(fileName, part.mimetype);
        if (!isSupportedChatImage(fileName, contentType)) throw new Error(`MESSAGE_AGENT_UNSUPPORTED_CHAT_IMAGE:${fileName}`);
        const tempPath = join(tempDir, messageAgentTempUploadName(fileName, fileIndex));
        await pipeline(part.file, createWriteStream(tempPath));
        const tempStats = await stat(tempPath);
        if (tempStats.size > maxMessageAgentChatImageBytes) throw new Error(`MESSAGE_AGENT_CHAT_IMAGE_TOO_LARGE:${fileName}`);
        tempPaths.push(tempPath);
        images.push({
          tempPath,
          fileName,
          contentType
        });
        fileIndex += 1;
      } else if (part.fieldname === "message") {
        message = String(part.value ?? "").trim();
      } else if (part.fieldname === "mode") {
        mode = z.enum(messageAgentChatModes).parse(String(part.value || "fast"));
      }
    }
    if (!message) return reply.code(400).send({ error: "MESSAGE_AGENT_MESSAGE_REQUIRED" });
    const response = await service.chat(sessionId, { message, mode, images });
    if (!response) return reply.code(404).send({ error: "MESSAGE_AGENT_SESSION_NOT_FOUND" });
    return response;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "MESSAGE_AGENT_CHAT_FAILED";
    return reply.code(400).send({ error: errorMessage });
  } finally {
    await cleanupMessageAgentTemp(tempPaths);
  }
}

function parseRelativePaths(value: unknown): string[] {
  if (value === undefined || value === null || value === "") return [];
  try {
    return z.array(z.string()).parse(JSON.parse(String(value)) as unknown);
  } catch {
    return String(value)
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean);
  }
}

function isMultipartRequest(request: FastifyRequest): boolean {
  return String(request.headers["content-type"] ?? "").toLowerCase().includes("multipart/form-data");
}

function isSupportedChatImage(fileName: string, contentType: string | null): boolean {
  const normalizedType = String(contentType ?? "").toLowerCase();
  return chatImageExtensions.has(extname(fileName).toLowerCase()) && normalizedType.startsWith("image/");
}
