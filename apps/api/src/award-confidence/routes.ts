import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AiClient } from "../ai/client.js";
import type { Env } from "../config/env.js";
import { AwardConfidenceService, awardConfidenceStorageRoot, cleanupAwardConfidenceTempFiles } from "./service.js";

const paramsSchema = z.object({ id: z.string().uuid() });
const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(5)
});

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

export async function registerAwardConfidenceRoutes(
  app: FastifyInstance,
  options: {
    ai: AiClient;
    env: Pick<Env, "NODE_ENV">;
    storageRoot?: string;
  }
) {
  const serviceStorageRoot = options.storageRoot ?? (options.env.NODE_ENV === "test" ? join(tmpdir(), "harmonia-award-confidence", randomUUID()) : undefined);
  const resolvedStorageRoot = awardConfidenceStorageRoot(serviceStorageRoot);
  const service = new AwardConfidenceService(resolvedStorageRoot, options.ai);

  app.post("/award-confidence/jobs", async (request, reply) => {
    const tempDir = join(resolvedStorageRoot, "tmp", randomUUID());
    await mkdir(tempDir, { recursive: true });
    const tempFiles: string[] = [];
    let workbook: { tempPath: string; fileName: string } | null = null;

    try {
      for await (const rawPart of request.parts() as AsyncIterable<MultipartPart>) {
        if (rawPart.type !== "file") continue;
        const tempPath = join(tempDir, tempUploadFileName(rawPart.filename || rawPart.fieldname, tempFiles.length));
        await pipeline(rawPart.file, createWriteStream(tempPath));
        tempFiles.push(tempPath);
        if (rawPart.fieldname === "workbook") {
          workbook = { tempPath, fileName: rawPart.filename };
        }
      }
      if (!workbook) return reply.code(400).send({ error: "AWARD_CONFIDENCE_WORKBOOK_REQUIRED" });
      if (!workbook.fileName.toLowerCase().endsWith(".xlsx")) return reply.code(400).send({ error: "AWARD_CONFIDENCE_WORKBOOK_MUST_BE_XLSX" });
      const job = await service.createJob({ workbookTempPath: workbook.tempPath, workbookFileName: workbook.fileName });
      return { job };
    } catch (error) {
      await cleanupAwardConfidenceTempFiles(tempFiles);
      const message = error instanceof Error ? error.message : "AWARD_CONFIDENCE_UPLOAD_FAILED";
      return reply.code(400).send({ error: message });
    } finally {
      await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined);
    }
  });

  app.get("/award-confidence/jobs", async (request) => {
    const query = listQuerySchema.parse(request.query);
    return service.listJobs(query.limit);
  });

  app.get("/award-confidence/jobs/:id", async (request, reply) => {
    const params = paramsSchema.parse(request.params);
    const snapshot = await service.getJob(params.id);
    if (!snapshot) return reply.code(404).send({ error: "AWARD_CONFIDENCE_JOB_NOT_FOUND" });
    return snapshot;
  });

  app.post("/award-confidence/jobs/:id/pause", async (request, reply) => {
    const params = paramsSchema.parse(request.params);
    const result = await service.pauseJob(params.id);
    if (!result) return reply.code(404).send({ error: "AWARD_CONFIDENCE_JOB_NOT_FOUND" });
    return result;
  });

  app.post("/award-confidence/jobs/:id/resume", async (request, reply) => {
    const params = paramsSchema.parse(request.params);
    const result = await service.resumeJob(params.id);
    if (!result) return reply.code(404).send({ error: "AWARD_CONFIDENCE_JOB_NOT_FOUND" });
    return result;
  });

  app.post("/award-confidence/jobs/:id/cancel", async (request, reply) => {
    const params = paramsSchema.parse(request.params);
    const result = await service.cancelJob(params.id);
    if (!result) return reply.code(404).send({ error: "AWARD_CONFIDENCE_JOB_NOT_FOUND" });
    return result;
  });

  app.delete("/award-confidence/jobs/:id", async (request, reply) => {
    const params = paramsSchema.parse(request.params);
    const deleted = await service.deleteJob(params.id);
    if (!deleted) return reply.code(404).send({ error: "AWARD_CONFIDENCE_JOB_NOT_FOUND" });
    return { ok: true };
  });

  app.get("/award-confidence/jobs/:id/result", async (request, reply) => {
    const params = paramsSchema.parse(request.params);
    const path = await service.resultPath(params.id);
    if (!path) {
      const known = await service.isKnownJob(params.id);
      return reply.code(known ? 409 : 404).send({ error: known ? "AWARD_CONFIDENCE_JOB_NOT_COMPLETE" : "AWARD_CONFIDENCE_JOB_NOT_FOUND" });
    }
    return reply
      .header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .header("Content-Disposition", `attachment; filename="${encodeURIComponent("award-confidence-result.xlsx")}"`)
      .send(createReadStream(path));
  });
}

function tempUploadFileName(rawName: string, index: number): string {
  const baseName = basename(rawName.replace(/\\/g, "/")) || "upload";
  const safeName = baseName.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").replace(/^\.+$/, "_").slice(0, 160) || "upload";
  return `${index}-${safeName}`;
}
