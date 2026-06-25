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
import { ScholarshipCheckService, scholarshipCheckStorageRoot } from "./service.js";

const paramsSchema = z.object({ id: z.string().uuid() });
const rowParamsSchema = paramsSchema.extend({ rowNumber: z.coerce.number().int().positive() });
const listQuerySchema = z.object({ limit: z.coerce.number().int().positive().max(50).default(5) });
const updateRemarkSchema = z.object({ remark: z.string().min(1), detail: z.string().min(1) });
const modeSchema = z.enum(["ai", "dry_run"]).default("ai");

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

export async function registerScholarshipCheckRoutes(
  app: FastifyInstance,
  options: {
    ai: AiClient;
    env: Pick<Env, "NODE_ENV" | "SCHOLARSHIP_CHECK_AI_IMAGES_PER_REQUEST" | "SCHOLARSHIP_CHECK_AI_PDF_IMAGE_WIDTH">;
    storageRoot?: string;
  }
) {
  const serviceStorageRoot =
    options.storageRoot ?? (options.env.NODE_ENV === "test" ? join(tmpdir(), "harmonia-scholarship-check", randomUUID()) : undefined);
  const resolvedStorageRoot = scholarshipCheckStorageRoot(serviceStorageRoot);
  const service = new ScholarshipCheckService(resolvedStorageRoot, options.ai, {
    imagesPerRequest: options.env.SCHOLARSHIP_CHECK_AI_IMAGES_PER_REQUEST,
    pdfImageWidth: options.env.SCHOLARSHIP_CHECK_AI_PDF_IMAGE_WIDTH
  });

  app.get("/scholarship-check/jobs", async (request) => {
    const query = listQuerySchema.parse(request.query);
    return service.listJobs(query.limit);
  });

  app.post("/scholarship-check/jobs", async (request, reply) => {
    const tempDir = join(resolvedStorageRoot, "tmp", randomUUID());
    await mkdir(tempDir, { recursive: true });
    let tempFileCount = 0;
    let workbook: { tempPath: string; fileName: string } | null = null;
    const evidenceFiles: Array<{ tempPath: string; fileName: string; contentType: string | null }> = [];
    let evidencePaths: string[] | null = null;
    let mode: "ai" | "dry_run" = "ai";

    try {
      for await (const rawPart of request.parts() as AsyncIterable<MultipartPart>) {
        if (rawPart.type === "file") {
          const tempPath = join(tempDir, tempUploadFileName(rawPart.filename || rawPart.fieldname, tempFileCount));
          await pipeline(rawPart.file, createWriteStream(tempPath));
          tempFileCount += 1;
          if (rawPart.fieldname === "workbook") {
            workbook = { tempPath, fileName: rawPart.filename };
          } else if (rawPart.fieldname === "evidenceFiles") {
            evidenceFiles.push({ tempPath, fileName: rawPart.filename, contentType: rawPart.mimetype || null });
          }
        } else if (rawPart.fieldname === "evidencePaths") {
          evidencePaths = parseEvidencePaths(rawPart.value);
        } else if (rawPart.fieldname === "mode") {
          mode = modeSchema.parse(String(rawPart.value || "ai"));
        }
      }

      if (!workbook) return reply.code(400).send({ error: "WORKBOOK_REQUIRED" });
      if (!workbook.fileName.toLowerCase().endsWith(".xlsx")) return reply.code(400).send({ error: "WORKBOOK_MUST_BE_XLSX" });
      if (!evidencePaths) return reply.code(400).send({ error: "EVIDENCE_PATHS_REQUIRED" });
      if (evidenceFiles.length === 0) return reply.code(400).send({ error: "EVIDENCE_FILES_REQUIRED" });

      const job = await service.createJob({
        workbookTempPath: workbook.tempPath,
        workbookFileName: workbook.fileName,
        evidenceFiles,
        evidencePaths,
        mode
      });
      return { job };
    } catch (error) {
      const message = error instanceof Error ? error.message : "SCHOLARSHIP_CHECK_UPLOAD_FAILED";
      return reply.code(400).send({ error: message });
    } finally {
      await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined);
    }
  });

  app.get("/scholarship-check/jobs/:id", async (request, reply) => {
    const params = paramsSchema.parse(request.params);
    const snapshot = await service.getJob(params.id);
    if (!snapshot) return reply.code(404).send({ error: "SCHOLARSHIP_CHECK_JOB_NOT_FOUND" });
    return snapshot;
  });

  app.patch("/scholarship-check/jobs/:id/rows/:rowNumber", async (request, reply) => {
    const params = rowParamsSchema.parse(request.params);
    const body = updateRemarkSchema.parse(request.body);
    try {
      const result = await service.updateRow(params.id, params.rowNumber, body.remark, body.detail, request.user?.email ?? null);
      if (!result) return reply.code(404).send({ error: "SCHOLARSHIP_CHECK_ROW_NOT_FOUND" });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "SCHOLARSHIP_CHECK_ROW_UPDATE_FAILED";
      return reply.code(400).send({ error: message });
    }
  });

  app.post("/scholarship-check/jobs/:id/pause", async (request, reply) => {
    const params = paramsSchema.parse(request.params);
    const result = await service.pauseJob(params.id);
    if (!result) return reply.code(404).send({ error: "SCHOLARSHIP_CHECK_JOB_NOT_FOUND" });
    return result;
  });

  app.post("/scholarship-check/jobs/:id/resume", async (request, reply) => {
    const params = paramsSchema.parse(request.params);
    const result = await service.resumeJob(params.id);
    if (!result) return reply.code(404).send({ error: "SCHOLARSHIP_CHECK_JOB_NOT_FOUND" });
    return result;
  });

  app.post("/scholarship-check/jobs/:id/cancel", async (request, reply) => {
    const params = paramsSchema.parse(request.params);
    const result = await service.cancelJob(params.id);
    if (!result) return reply.code(404).send({ error: "SCHOLARSHIP_CHECK_JOB_NOT_FOUND" });
    return result;
  });

  app.delete("/scholarship-check/jobs/:id", async (request, reply) => {
    const params = paramsSchema.parse(request.params);
    const deleted = await service.deleteJob(params.id);
    if (!deleted) return reply.code(404).send({ error: "SCHOLARSHIP_CHECK_JOB_NOT_FOUND" });
    return { ok: true };
  });

  app.get("/scholarship-check/jobs/:id/result", async (request, reply) => {
    const params = paramsSchema.parse(request.params);
    const path = await service.resultPath(params.id);
    if (!path) {
      const known = await service.isKnownJob(params.id);
      return reply.code(known ? 409 : 404).send({ error: known ? "SCHOLARSHIP_CHECK_JOB_NOT_COMPLETE" : "SCHOLARSHIP_CHECK_JOB_NOT_FOUND" });
    }
    return reply
      .header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .header("Content-Disposition", `attachment; filename="${encodeURIComponent("scholarship-check-result.xlsx")}"`)
      .send(createReadStream(path));
  });
}

function parseEvidencePaths(value: unknown): string[] {
  const parsed = JSON.parse(String(value ?? "[]")) as unknown;
  return z.array(z.string()).parse(parsed);
}

function tempUploadFileName(rawName: string, index: number): string {
  const baseName = basename(rawName.replace(/\\/g, "/")) || "upload";
  const safeName = baseName.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").replace(/^\.+$/, "_").slice(0, 160) || "upload";
  return `${index}-${safeName}`;
}
