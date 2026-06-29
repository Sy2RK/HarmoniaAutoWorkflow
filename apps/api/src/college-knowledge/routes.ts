import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { collegeKnowledgeChatModes, type CollegeKnowledgeChatMode } from "@harmonia/shared";
import type { AiClient } from "../ai/client.js";
import type { Env } from "../config/env.js";
import type { AppRepository } from "../db/repository.js";
import { CollegeKnowledgeService } from "./service.js";
import { collegeKnowledgeStorageRoot, contentTypeFromName, tempUploadFileName } from "./storage.js";
import type { CollegeKnowledgeImageInput } from "./service.js";
import type { KnowledgeUploadFile } from "./types.js";

const paramsSchema = z.object({ id: z.string().uuid() });
const jsonChatSchema = z.object({
  question: z.string().min(1).max(4000).optional(),
  message: z.string().min(1).max(4000).optional(),
  mode: z.enum(collegeKnowledgeChatModes).optional()
});
const chatModeSchema = z.enum(collegeKnowledgeChatModes);

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

export async function registerCollegeKnowledgeRoutes(
  app: FastifyInstance,
  options: {
    repo: AppRepository;
    ai: AiClient;
    env: Pick<Env, "NODE_ENV">;
    storageRoot?: string;
    rerankEnabled?: boolean;
  }
) {
  const serviceStorageRoot =
    options.storageRoot ?? (options.env.NODE_ENV === "test" ? join(tmpdir(), "harmonia-college-knowledge", randomUUID()) : undefined);
  const service = new CollegeKnowledgeService(options.repo, options.ai, collegeKnowledgeStorageRoot(serviceStorageRoot), {
    rerankEnabled: options.rerankEnabled ?? false
  });

  app.get("/college-knowledge/documents", async () => service.listDocuments());

  app.post("/college-knowledge/documents/upload", async (request, reply) => {
    const tempDir = join(collegeKnowledgeStorageRoot(serviceStorageRoot), "tmp", randomUUID());
    await mkdir(tempDir, { recursive: true });
    const tempPaths: string[] = [tempDir];
    const files: KnowledgeUploadFile[] = [];
    let relativePaths: string[] = [];
    try {
      let fileIndex = 0;
      for await (const rawPart of request.parts() as AsyncIterable<MultipartPart>) {
        if (rawPart.type === "file") {
          const tempPath = join(tempDir, tempUploadFileName(rawPart.filename || rawPart.fieldname, fileIndex));
          await pipeline(rawPart.file, createWriteStream(tempPath));
          tempPaths.push(tempPath);
          files.push({
            tempPath,
            fileName: rawPart.filename || rawPart.fieldname,
            contentType: contentTypeFromName(rawPart.filename || rawPart.fieldname, rawPart.mimetype),
            relativePath: null
          });
          fileIndex += 1;
        } else if (rawPart.fieldname === "relativePaths") {
          relativePaths = parseRelativePaths(rawPart.value);
        }
      }
      if (files.length === 0) return reply.code(400).send({ error: "COLLEGE_KNOWLEDGE_FILES_REQUIRED" });
      const withRelativePaths = files.map((file, index) => ({
        ...file,
        relativePath: relativePaths[index] ?? file.fileName
      }));
      const result = await service.uploadFiles(withRelativePaths);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "COLLEGE_KNOWLEDGE_UPLOAD_FAILED";
      return reply.code(400).send({ error: message });
    } finally {
      await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined);
      await Promise.all(tempPaths.slice(1).map((path) => rm(path, { force: true }).catch(() => undefined)));
    }
  });

  app.post("/college-knowledge/documents/:id/reindex", async (request, reply) => {
    const params = paramsSchema.parse(request.params);
    const document = await service.reindexDocument(params.id);
    if (!document) return reply.code(404).send({ error: "COLLEGE_KNOWLEDGE_DOCUMENT_NOT_FOUND" });
    return { document };
  });

  app.delete("/college-knowledge/documents/:id", async (request, reply) => {
    const params = paramsSchema.parse(request.params);
    const deleted = await service.deleteDocument(params.id);
    if (!deleted) return reply.code(404).send({ error: "COLLEGE_KNOWLEDGE_DOCUMENT_NOT_FOUND" });
    return { ok: true };
  });

  app.post("/college-knowledge/chat", async (request, reply) => {
    if (isMultipartRequest(request)) return handleMultipartChat(request, reply, service, serviceStorageRoot);
    const body = jsonChatSchema.parse(request.body);
    const question = body.question ?? body.message;
    if (!question) return reply.code(400).send({ error: "COLLEGE_KNOWLEDGE_QUESTION_REQUIRED" });
    return service.chat({ question, images: [], ...(body.mode === undefined ? {} : { mode: body.mode }) });
  });
}

async function handleMultipartChat(
  request: FastifyRequest,
  reply: FastifyReply,
  service: CollegeKnowledgeService,
  storageRoot: string | undefined
) {
  const tempDir = join(collegeKnowledgeStorageRoot(storageRoot), "tmp", randomUUID());
  await mkdir(tempDir, { recursive: true });
  const images: CollegeKnowledgeImageInput[] = [];
  let question = "";
  let mode: CollegeKnowledgeChatMode | undefined;
  try {
    let fileIndex = 0;
    for await (const rawPart of request.parts() as AsyncIterable<MultipartPart>) {
      if (rawPart.type === "file") {
        const tempPath = join(tempDir, tempUploadFileName(rawPart.filename || rawPart.fieldname, fileIndex));
        await pipeline(rawPart.file, createWriteStream(tempPath));
        images.push({
          tempPath,
          fileName: rawPart.filename || rawPart.fieldname,
          contentType: contentTypeFromName(rawPart.filename || rawPart.fieldname, rawPart.mimetype)
        });
        fileIndex += 1;
      } else if (rawPart.fieldname === "question" || rawPart.fieldname === "message") {
        question = String(rawPart.value ?? "").trim();
      } else if (rawPart.fieldname === "mode") {
        mode = chatModeSchema.parse(String(rawPart.value ?? ""));
      }
    }
    if (!question) return reply.code(400).send({ error: "COLLEGE_KNOWLEDGE_QUESTION_REQUIRED" });
    const result = await service.chat({ question, images, ...(mode === undefined ? {} : { mode }) });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "COLLEGE_KNOWLEDGE_CHAT_FAILED";
    return reply.code(400).send({ error: message });
  } finally {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined);
  }
}

function parseRelativePaths(value: unknown): string[] {
  if (value === undefined || value === null || value === "") return [];
  try {
    const parsed = JSON.parse(String(value)) as unknown;
    return z.array(z.string()).parse(parsed);
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
