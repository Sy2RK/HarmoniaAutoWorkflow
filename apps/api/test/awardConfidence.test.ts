import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { buildApp } from "../src/app.js";
import { NoopAiClient } from "../src/ai/client.js";
import type { AwardConfidenceTextEvaluationInput } from "../src/ai/client.js";
import { hashPassword } from "../src/auth/session.js";
import { AwardConfidenceService } from "../src/award-confidence/service.js";
import { awardProfiles, scoreAwardConfidence } from "../src/award-confidence/scoring.js";
import type { AwardConfidenceSourceRow } from "../src/award-confidence/types.js";
import { confidenceColumns, parseAwardConfidenceWorkbook } from "../src/award-confidence/workbook.js";
import type { Env } from "../src/config/env.js";
import { InMemoryRepository } from "../src/db/memory.js";
import type { GraphMailClient } from "../src/graph/client.js";
import type { OutboundMailer } from "../src/mail/outbound.js";

const env: Env = {
  NODE_ENV: "test",
  PORT: 4000,
  WEB_ORIGIN: "http://localhost:5173",
  SESSION_SECRET: "test-session-secret-with-enough-length",
  APP_TIMEZONE: "Asia/Shanghai",
  DB_DRIVER: "sqlite",
  SQLITE_DB_PATH: ":memory:",
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

describe("award confidence scoring", () => {
  it("uses AI subitem scores and risk penalty in the weighted formula", () => {
    const base = {
      fieldScores: {
        personalStatement: 0.8,
        collegeContribution: 0.8,
        servicePractice: 0.9,
        dormService: 0.8,
        academic: 0.5,
        studentOrg: 0.4,
        awardsGeneral: 0.6,
        sports: 0.1,
        artsTalent: 0.1
      },
      summary: "match"
    };

    expect(scoreAwardConfidence("优秀服务奖", { ...base, riskPenalty: 0.2 })).toBeLessThan(
      scoreAwardConfidence("优秀服务奖", { ...base, riskPenalty: 0 }) ?? 0
    );
  });

  it("uses award-specific college-related field weights", () => {
    const evaluation = {
      fieldScores: {
        personalStatement: 0.7,
        collegeContribution: 0.4,
        servicePractice: 0.2,
        dormService: 0.1,
        academic: 0.3,
        studentOrg: 0.4,
        awardsGeneral: 0.3,
        sports: 1,
        artsTalent: 0
      },
      riskPenalty: 0,
      summary: "sports only"
    };

    expect(scoreAwardConfidence("卓越体育贡献奖", evaluation)).toBeGreaterThan(scoreAwardConfidence("优秀服务奖", evaluation) ?? 0);
  });

  it("ignores academic performance and generic awards in the final formula", () => {
    const collegeScopedEvaluation = {
      fieldScores: {
        personalStatement: 0.5,
        collegeContribution: 0.5,
        servicePractice: 0.5,
        dormService: 0.5,
        academic: 0,
        studentOrg: 0.5,
        awardsGeneral: 0,
        sports: 0.5,
        artsTalent: 0.5
      },
      riskPenalty: 0,
      summary: "college-scoped"
    };
    const inflatedNonCollegeEvaluation = {
      ...collegeScopedEvaluation,
      fieldScores: {
        ...collegeScopedEvaluation.fieldScores,
        academic: 1,
        awardsGeneral: 1
      }
    };

    expect(scoreAwardConfidence("院长嘉许奖", inflatedNonCollegeEvaluation)).toBe(scoreAwardConfidence("院长嘉许奖", collegeScopedEvaluation));
    expect(scoreAwardConfidence("卓越体育贡献奖", inflatedNonCollegeEvaluation)).toBe(scoreAwardConfidence("卓越体育贡献奖", collegeScopedEvaluation));
  });

  it("keeps the documented award profile weights", () => {
    expect(awardProfiles["院长嘉许奖"].fieldWeights).toMatchObject({ collegeContribution: 0.3, servicePractice: 0.2, dormService: 0.15 });
    expect(awardProfiles["杰出领导力奖"].fieldWeights).toMatchObject({ studentOrg: 0.5, collegeContribution: 0.2 });
    expect(awardProfiles["优秀服务奖"].fieldWeights).toMatchObject({ servicePractice: 0.4, dormService: 0.25 });
    expect(awardProfiles["卓越体育贡献奖"].fieldWeights).toMatchObject({ sports: 0.5, collegeContribution: 0.2 });
    expect(awardProfiles["卓越才艺贡献奖"].fieldWeights).toMatchObject({ artsTalent: 0.5, collegeContribution: 0.2 });
    for (const profile of Object.values(awardProfiles)) {
      expect(profile.fieldWeights).not.toHaveProperty("academic");
      expect(profile.fieldWeights).not.toHaveProperty("awardsGeneral");
    }
  });
});

describe("award confidence service recovery", () => {
  it("auto-resumes legacy restart-paused jobs after service restart", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "award-confidence-restart-"));
    const jobId = "restart-award-confidence";
    const rootDir = join(storageRoot, jobId);
    const inputDir = join(rootDir, "input");
    const workbookPath = join(inputDir, "workbook.xlsx");
    const createdAt = new Date("2026-01-01T00:00:00.000Z").toISOString();
    const restartPauseMessage = "\u4efb\u52a1\u56e0\u670d\u52a1\u91cd\u542f\u5df2\u6682\u505c\uff0c\u53ef\u70b9\u51fb\u7ee7\u7eed\u6062\u590d\u3002";

    try {
      await mkdir(inputDir, { recursive: true });
      await writeFile(workbookPath, confidenceWorkbook());
      const rows = parseAwardConfidenceWorkbook(workbookPath).map((sourceRow, index) => ({
        sheetName: sourceRow.sheetName,
        rowNumber: sourceRow.rowNumber,
        name: sourceRow.name,
        firstAward: sourceRow.firstAward,
        secondAward: sourceRow.secondAward,
        firstAwardConfidence: null,
        secondAwardConfidence: null,
        status: index === 0 ? "processing" : "pending",
        error: null
      }));
      await writeFile(
        join(rootDir, "job.json"),
        JSON.stringify(
          {
            job: {
              id: jobId,
              status: "paused",
              createdAt,
              updatedAt: createdAt,
              totalRows: rows.length,
              processedRows: 0,
              error: restartPauseMessage,
              rootDir,
              workbookPath,
              resultPath: null
            },
            rows
          },
          null,
          2
        )
      );
      await writeFile(join(storageRoot, "index.json"), JSON.stringify({ ids: [jobId] }));

      const service = new AwardConfidenceService(storageRoot, new FakeAwardConfidenceAiClient());
      const completed = await waitForAwardServiceJob(service, jobId, "completed");

      expect(completed.job.status).toBe("completed");
      expect(completed.job.error).toBeNull();
      expect(completed.rows.every((row) => row.status === "completed")).toBe(true);
    } finally {
      await rm(storageRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});

describe("award confidence routes", () => {
  it("processes only the total sheet, preserves sheets, and appends exactly two confidence columns to total", async () => {
    const ai = new FakeAwardConfidenceAiClient();
    const { app, storageRoot } = await testApp(ai);
    const cookie = await loginCookie(app);
    const boundary = "award-confidence-success";
    try {
      const create = await app.inject({
        method: "POST",
        url: "/award-confidence/jobs",
        headers: { ...multipartHeaders(boundary), cookie },
        payload: multipartBody(boundary, [
          {
            name: "workbook",
            filename: "award-confidence.xlsx",
            contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            value: confidenceWorkbook()
          }
        ])
      });
      expect(create.statusCode).toBe(200);
      const jobId = create.json().job.id as string;
      const completed = await waitForAwardJob(app, cookie, jobId);
      expect(completed.job).toMatchObject({ status: "completed", totalRows: 2, processedRows: 2 });
      expect(completed.rows[0]).toMatchObject({
        sheetName: "总表",
        name: "张三",
        firstAward: "优秀服务奖",
        secondAward: null,
        status: "completed"
      });
      expect(completed.rows[0].firstAwardConfidence).toEqual(expect.any(Number));
      expect(completed.rows[0].secondAwardConfidence).toBeNull();
      expect(ai.calls).toHaveLength(3);
      expect(ai.calls[0]?.fields.personalStatement).toBeTruthy();
      expect(ai.calls[0]?.fields.servicePractice).toBeTruthy();

      const result = await app.inject({ method: "GET", url: `/award-confidence/jobs/${jobId}/result`, headers: { cookie } });
      expect(result.statusCode).toBe(200);
      const workbook = XLSX.read(result.rawPayload, { type: "buffer" });
      expect(workbook.SheetNames).toEqual(["总表", "说明", "①院长嘉许奖"]);

      const totalRows = sheetRows(workbook, "总表");
      expect(totalRows[0]?.slice(-2)).toEqual([...confidenceColumns]);
      expect(totalRows[1]?.[totalRows[0]!.length - 2]).toEqual(completed.rows[0].firstAwardConfidence);
      expect(totalRows[1]?.[totalRows[0]!.length - 1]).toBe("");

      const untouchedRows = sheetRows(workbook, "说明");
      expect(untouchedRows[0]).toEqual(["字段", "值"]);
      expect(untouchedRows[0]).toHaveLength(2);

      const awardRows = sheetRows(workbook, "①院长嘉许奖");
      expect(awardRows[0]).not.toContain(confidenceColumns[0]);
      expect(awardRows[0]).not.toContain(confidenceColumns[1]);
    } finally {
      await app.close();
      await rm(storageRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("rejects missing, non-xlsx, and workbook-without-award-column uploads", async () => {
    const { app, storageRoot } = await testApp();
    const cookie = await loginCookie(app);
    try {
      const missing = await app.inject({
        method: "POST",
        url: "/award-confidence/jobs",
        headers: { ...multipartHeaders("missing"), cookie },
        payload: multipartBody("missing", [])
      });
      expect(missing.statusCode).toBe(400);
      expect(missing.json()).toMatchObject({ error: "AWARD_CONFIDENCE_WORKBOOK_REQUIRED" });

      const nonXlsx = await app.inject({
        method: "POST",
        url: "/award-confidence/jobs",
        headers: { ...multipartHeaders("non-xlsx"), cookie },
        payload: multipartBody("non-xlsx", [{ name: "workbook", filename: "input.txt", contentType: "text/plain", value: Buffer.from("not excel") }])
      });
      expect(nonXlsx.statusCode).toBe(400);
      expect(nonXlsx.json()).toMatchObject({ error: "AWARD_CONFIDENCE_WORKBOOK_MUST_BE_XLSX" });

      const badWorkbook = await app.inject({
        method: "POST",
        url: "/award-confidence/jobs",
        headers: { ...multipartHeaders("bad-workbook"), cookie },
        payload: multipartBody("bad-workbook", [
          {
            name: "workbook",
            filename: "bad.xlsx",
            contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            value: workbookFromSheets({ 总表: [["姓名", "个人陈述"], ["张三", "text"]] })
          }
        ])
      });
      expect(badWorkbook.statusCode).toBe(400);
      expect(badWorkbook.json()).toMatchObject({ error: "AWARD_CONFIDENCE_MISSING_AWARD_COLUMNS" });

      const noTotalSheet = await app.inject({
        method: "POST",
        url: "/award-confidence/jobs",
        headers: { ...multipartHeaders("no-total-sheet"), cookie },
        payload: multipartBody("no-total-sheet", [
          {
            name: "workbook",
            filename: "no-total.xlsx",
            contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            value: workbookFromSheets({
              Other: [["姓名", "申请奖项 第一奖项", "申请奖项 第二奖项"], ["张三", "优秀服务奖", ""]]
            })
          }
        ])
      });
      expect(noTotalSheet.statusCode).toBe(400);
      expect(noTotalSheet.json()).toMatchObject({ error: "AWARD_CONFIDENCE_TOTAL_SHEET_REQUIRED" });
    } finally {
      await app.close();
      await rm(storageRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("sanitizes multipart filenames and removes upload temp batches", async () => {
    const ai = new FakeAwardConfidenceAiClient();
    const { app, storageRoot } = await testApp(ai);
    const cookie = await loginCookie(app);
    const boundary = "award-confidence-safe-name";
    try {
      const create = await app.inject({
        method: "POST",
        url: "/award-confidence/jobs",
        headers: { ...multipartHeaders(boundary), cookie },
        payload: multipartBody(boundary, [
          {
            name: "workbook",
            filename: "../award-confidence.xlsx",
            contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            value: confidenceWorkbook()
          },
          {
            name: "ignored",
            filename: "nested/../../leak.txt",
            contentType: "text/plain",
            value: Buffer.from("must not escape temp batch")
          }
        ])
      });

      expect(create.statusCode, create.body).toBe(200);
      await waitForAwardJob(app, cookie, create.json().job.id as string);
      const tempEntries = await readdir(join(storageRoot, "tmp")).catch(() => []);
      expect(tempEntries).toEqual([]);
    } finally {
      await app.close();
      await rm(storageRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("lists and retains the five most recent award confidence jobs", async () => {
    const ai = new FakeAwardConfidenceAiClient();
    const { app, storageRoot } = await testApp(ai);
    const cookie = await loginCookie(app);
    const jobIds: string[] = [];
    try {
      for (let index = 0; index < 6; index += 1) {
        const jobId = await createAwardConfidenceJob(app, cookie, `award-confidence-history-${index}`);
        jobIds.push(jobId);
        await waitForAwardJob(app, cookie, jobId);
      }

      const list = await app.inject({ method: "GET", url: "/award-confidence/jobs?limit=5", headers: { cookie } });
      expect(list.statusCode).toBe(200);
      const payload = list.json() as { items: Array<{ id: string }>; total: number };
      expect(payload.items).toHaveLength(5);
      expect(payload.total).toBe(5);
      expect(payload.items.map((item) => item.id)).toEqual(jobIds.slice(1).reverse());

      const evicted = await app.inject({ method: "GET", url: `/award-confidence/jobs/${jobIds[0]}`, headers: { cookie } });
      expect(evicted.statusCode).toBe(404);
    } finally {
      await app.close();
      await rm(storageRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("removes deleted award confidence jobs from recent records", async () => {
    const ai = new FakeAwardConfidenceAiClient();
    const { app, storageRoot } = await testApp(ai);
    const cookie = await loginCookie(app);
    try {
      const jobId = await createAwardConfidenceJob(app, cookie, "award-confidence-history-delete");
      await waitForAwardJob(app, cookie, jobId);

      const beforeDelete = await app.inject({ method: "GET", url: "/award-confidence/jobs?limit=5", headers: { cookie } });
      expect(beforeDelete.statusCode).toBe(200);
      expect((beforeDelete.json() as { items: Array<{ id: string }> }).items.map((item) => item.id)).toContain(jobId);

      const deleted = await app.inject({ method: "DELETE", url: `/award-confidence/jobs/${jobId}`, headers: { cookie } });
      expect(deleted.statusCode).toBe(200);
      expect(deleted.json()).toEqual({ ok: true });

      const afterDelete = await app.inject({ method: "GET", url: "/award-confidence/jobs?limit=5", headers: { cookie } });
      expect(afterDelete.statusCode).toBe(200);
      expect((afterDelete.json() as { items: Array<{ id: string }> }).items.map((item) => item.id)).not.toContain(jobId);

      const missing = await app.inject({ method: "GET", url: `/award-confidence/jobs/${jobId}`, headers: { cookie } });
      expect(missing.statusCode).toBe(404);
    } finally {
      await app.close();
      await rm(storageRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("pauses and resumes an in-flight award confidence job", async () => {
    const ai = new BlockingAwardConfidenceAiClient();
    const { app, storageRoot } = await testApp(ai);
    const cookie = await loginCookie(app);
    const boundary = "award-confidence-pause";
    try {
      const create = await app.inject({
        method: "POST",
        url: "/award-confidence/jobs",
        headers: { ...multipartHeaders(boundary), cookie },
        payload: multipartBody(boundary, [
          {
            name: "workbook",
            filename: "award-confidence.xlsx",
            contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            value: confidenceWorkbook()
          }
        ])
      });
      expect(create.statusCode).toBe(200);
      const jobId = create.json().job.id as string;
      await waitForAiCall(ai);

      const pause = await app.inject({ method: "POST", url: `/award-confidence/jobs/${jobId}/pause`, headers: { cookie } });
      expect(pause.statusCode).toBe(200);
      expect(pause.json().job.status).toBe("paused");

      ai.releaseOne();
      const paused = await waitForAwardJobStatus(app, cookie, jobId, "paused");
      expect(paused.job.status).toBe("paused");

      const resume = await app.inject({ method: "POST", url: `/award-confidence/jobs/${jobId}/resume`, headers: { cookie } });
      expect(resume.statusCode).toBe(200);
      expect(resume.json().job.status).toBe("queued");

      const completed = await completeBlockingAwardJob(app, cookie, jobId, ai);
      expect(completed.job.status).toBe("completed");
      expect(completed.job.processedRows).toBe(completed.job.totalRows);
    } finally {
      ai.releaseAll();
      await app.close();
      await rm(storageRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("cancels an in-flight award confidence job and downloads a partial workbook", async () => {
    const ai = new BlockingAwardConfidenceAiClient();
    const { app, storageRoot } = await testApp(ai);
    const cookie = await loginCookie(app);
    const boundary = "award-confidence-cancel";
    try {
      const create = await app.inject({
        method: "POST",
        url: "/award-confidence/jobs",
        headers: { ...multipartHeaders(boundary), cookie },
        payload: multipartBody(boundary, [
          {
            name: "workbook",
            filename: "award-confidence.xlsx",
            contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            value: confidenceWorkbook()
          }
        ])
      });
      expect(create.statusCode).toBe(200);
      const jobId = create.json().job.id as string;
      await waitForAiCall(ai);

      const cancel = await app.inject({ method: "POST", url: `/award-confidence/jobs/${jobId}/cancel`, headers: { cookie } });
      expect(cancel.statusCode).toBe(200);
      expect(cancel.json().job.status).toBe("cancelled");
      expect(cancel.json().rows.some((row: { status: string }) => row.status === "cancelled")).toBe(true);

      const result = await app.inject({ method: "GET", url: `/award-confidence/jobs/${jobId}/result`, headers: { cookie } });
      expect(result.statusCode).toBe(200);
      const workbook = XLSX.read(result.rawPayload, { type: "buffer" });
      expect(sheetRows(workbook, workbook.SheetNames[0]!)[0]?.slice(-2)).toEqual([...confidenceColumns]);

      ai.releaseAll();
      const persisted = await waitForAwardJobStatus(app, cookie, jobId, "cancelled");
      expect(persisted.job.status).toBe("cancelled");
    } finally {
      ai.releaseAll();
      await app.close();
      await rm(storageRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("deletes an in-flight award confidence job without recreating the record", async () => {
    const ai = new BlockingAwardConfidenceAiClient();
    const { app, storageRoot } = await testApp(ai);
    const cookie = await loginCookie(app);
    const boundary = "award-confidence-delete";
    try {
      const create = await app.inject({
        method: "POST",
        url: "/award-confidence/jobs",
        headers: { ...multipartHeaders(boundary), cookie },
        payload: multipartBody(boundary, [
          {
            name: "workbook",
            filename: "award-confidence.xlsx",
            contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            value: confidenceWorkbook()
          }
        ])
      });
      expect(create.statusCode).toBe(200);
      const jobId = create.json().job.id as string;
      await waitForAiCall(ai);

      const deleted = await app.inject({ method: "DELETE", url: `/award-confidence/jobs/${jobId}`, headers: { cookie } });
      expect(deleted.statusCode).toBe(200);
      expect(deleted.json()).toEqual({ ok: true });

      const missing = await app.inject({ method: "GET", url: `/award-confidence/jobs/${jobId}`, headers: { cookie } });
      expect(missing.statusCode).toBe(404);

      ai.releaseAll();
      await new Promise((resolve) => setTimeout(resolve, 50));
      const stillMissing = await app.inject({ method: "GET", url: `/award-confidence/jobs/${jobId}`, headers: { cookie } });
      expect(stillMissing.statusCode).toBe(404);
    } finally {
      ai.releaseAll();
      await app.close();
      await rm(storageRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});

async function testApp(ai = new NoopAiClient()) {
  const storageRoot = await mkdtemp(join(tmpdir(), "harmonia-award-confidence-"));
  const repo = new InMemoryRepository("public@example.edu.cn");
  await repo.ensureAdminUser(env.ADMIN_EMAIL, await hashPassword(env.ADMIN_PASSWORD));
  const app = await buildApp({
    env,
    repo,
    ai,
    awardConfidenceAi: ai,
    mailer,
    graph,
    awardConfidenceStorageRoot: storageRoot,
    attachmentRoot: env.ATTACHMENT_STORAGE_DIR
  });
  return { app, storageRoot };
}

class FakeAwardConfidenceAiClient extends NoopAiClient {
  readonly calls: AwardConfidenceTextEvaluationInput[] = [];

  async evaluateAwardConfidence(input: AwardConfidenceTextEvaluationInput) {
    this.calls.push(input);
    const award = input.awardName;
    return {
      fieldScores: {
        personalStatement: 0.75,
        collegeContribution: award.includes("服务") ? 0.85 : 0.55,
        servicePractice: award.includes("服务") ? 0.95 : 0.45,
        dormService: award.includes("服务") ? 0.8 : 0.35,
        academic: 0,
        studentOrg: award.includes("领导") ? 0.9 : 0.5,
        awardsGeneral: 0.2,
        sports: award.includes("体育") ? 0.92 : 0.1,
        artsTalent: award.includes("才艺") ? 0.92 : 0.1
      },
      riskPenalty: input.notes.includes("不清晰") ? 0.08 : 0,
      summary: "fake ai"
    };
  }
}

class BlockingAwardConfidenceAiClient extends NoopAiClient {
  readonly calls: AwardConfidenceTextEvaluationInput[] = [];
  private readonly pending: Array<() => void> = [];

  async evaluateAwardConfidence(input: AwardConfidenceTextEvaluationInput) {
    this.calls.push(input);
    await new Promise<void>((resolve) => {
      this.pending.push(resolve);
    });
    return {
      fieldScores: {
        personalStatement: 0.8,
        collegeContribution: 0.8,
        servicePractice: 0.8,
        dormService: 0.8,
        academic: 0.8,
        studentOrg: 0.8,
        awardsGeneral: 0.8,
        sports: 0.8,
        artsTalent: 0.8
      },
      riskPenalty: 0,
      summary: "blocking fake ai"
    };
  }

  releaseOne(): void {
    this.pending.shift()?.();
  }

  releaseAll(): void {
    while (this.pending.length) this.releaseOne();
  }
}

async function loginCookie(app: Awaited<ReturnType<typeof buildApp>>): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD }
  });
  expect(response.statusCode).toBe(200);
  return String(response.headers["set-cookie"]);
}

async function createAwardConfidenceJob(app: Awaited<ReturnType<typeof buildApp>>, cookie: string, boundary: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/award-confidence/jobs",
    headers: { ...multipartHeaders(boundary), cookie },
    payload: multipartBody(boundary, [
      {
        name: "workbook",
        filename: "award-confidence.xlsx",
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        value: confidenceWorkbook()
      }
    ])
  });
  expect(response.statusCode).toBe(200);
  return response.json().job.id as string;
}

function sourceRow(overrides: Partial<{
  status: string;
  firstAward: string | null;
  secondAward: string | null;
  servicePractice: string;
  notes: string;
}> = {}): AwardConfidenceSourceRow {
  return {
    sheetName: "总表",
    rowNumber: 2,
    name: "张三",
    initialStatus: overrides.status ?? "入围",
    firstAward: overrides.firstAward ?? "优秀服务奖",
    secondAward: overrides.secondAward ?? null,
    personalStatement: "长期参与书院社区服务和志愿服务，组织同学参加公益活动。",
    firstRecommender: "王老师 13800000000",
    secondRecommender: "李老师 mentor@example.com",
    dimensions: {
      collegeContribution: "1、书院活动组织 3分 有证明",
      servicePractice: overrides.servicePractice ?? "1、志愿服务 4分 有证明\n2、社区服务 4分 有证明",
      dormService: "1、宿舍服务 3分 有证明",
      academic: "GPA 3.7/4.0",
      studentOrg: "1、学生会部长 有证明",
      awardsGeneral: "1、公益奖项 有证明",
      sports: "",
      artsTalent: ""
    },
    notes: overrides.notes ?? ""
  };
}

function confidenceWorkbook(): Buffer {
  return workbookFromSheets({
    总表: [
      [
        "序号",
        "初审情况",
        "姓名",
        "申请奖项\r\n第一奖项",
        "申请奖项\r\n第二奖项",
        "个人陈述",
        "第一位推荐人",
        "第二位推荐人",
        "书院活动贡献",
        "社会服务实践和成就",
        "宿舍生活服务",
        "学业表现",
        "学生组织",
        "奖项/其他",
        "核对备注说明"
      ],
      [
        1,
        "入围",
        "张三",
        "优秀服务奖",
        "",
        "长期参与书院社区服务和志愿服务。",
        "王老师 13800000000",
        "李老师 mentor@example.com",
        "1、书院活动组织 3分 有证明",
        "1、志愿服务 4分 有证明\n2、社区服务 4分 有证明",
        "1、宿舍服务 3分 有证明",
        "GPA 3.8/4.0",
        "1、学生会部长 有证明",
        "1、公益奖项 有证明",
        ""
      ],
      [
        2,
        "未入围",
        "李四",
        "卓越体育贡献奖",
        "卓越才艺贡献奖",
        "校队运动员，也参与音乐演出。",
        "陈老师",
        "",
        "1、书院活动 2分 有证明",
        "1、志愿服务 2分 无证明",
        "",
        "GPA 3.1/4.0",
        "1、体育队队长 有证明",
        "1、篮球比赛 8分 有证明\n2、音乐演出 5分 有证明",
        "材料不清晰"
      ]
    ],
    说明: [
      ["字段", "值"],
      ["版本", "测试"]
    ],
    "①院长嘉许奖": [
      ["姓名", "申请奖项 第一奖项", "申请奖项 第二奖项", "初审情况", "学业表现", "个人陈述", "第一位推荐人", "第二位推荐人"],
      ["王五", "院长嘉许奖", "杰出领导力奖", "入围", "GPA 3.9", "学业和领导力突出", "导师 13900000000", "老师 second@example.com"]
    ]
  });
}

function workbookFromSheets(sheets: Record<string, Array<Array<string | number>>>): Buffer {
  const workbook = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function sheetRows(workbook: XLSX.WorkBook, sheetName: string): Array<Array<string | number>> {
  const worksheet = workbook.Sheets[sheetName];
  expect(worksheet).toBeTruthy();
  return XLSX.utils.sheet_to_json<Array<string | number>>(worksheet!, { header: 1, defval: "" });
}

function multipartHeaders(boundary: string): Record<string, string> {
  return { "content-type": `multipart/form-data; boundary=${boundary}` };
}

type MultipartTestPart = { name: string; value: string } | { name: string; filename: string; contentType: string; value: Buffer };

function multipartBody(boundary: string, parts: MultipartTestPart[]): Buffer {
  const chunks: Buffer[] = [];
  for (const part of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    if ("filename" in part) {
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\nContent-Type: ${part.contentType}\r\n\r\n`));
      chunks.push(part.value);
      chunks.push(Buffer.from("\r\n"));
    } else {
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="${part.name}"\r\n\r\n${part.value}\r\n`));
    }
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(chunks);
}

async function waitForAwardJob(app: Awaited<ReturnType<typeof buildApp>>, cookie: string, jobId: string) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await app.inject({ method: "GET", url: `/award-confidence/jobs/${jobId}`, headers: { cookie } });
    expect(response.statusCode).toBe(200);
    const payload = response.json();
    if (payload.job.status === "completed" || payload.job.status === "failed") return payload;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Award confidence job did not finish");
}

async function waitForAwardJobStatus(app: Awaited<ReturnType<typeof buildApp>>, cookie: string, jobId: string, status: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await app.inject({ method: "GET", url: `/award-confidence/jobs/${jobId}`, headers: { cookie } });
    expect(response.statusCode).toBe(200);
    const payload = response.json();
    if (payload.job.status === status) return payload;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Award confidence job did not reach ${status}`);
}

async function waitForAwardServiceJob(service: AwardConfidenceService, jobId: string, status: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const payload = await service.getJob(jobId);
    expect(payload).toBeTruthy();
    if (payload?.job.status === status) return payload;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Award confidence service job did not reach ${status}`);
}

async function waitForAiCall(ai: BlockingAwardConfidenceAiClient, count = 1) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (ai.calls.length >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("AI call did not start");
}

async function completeBlockingAwardJob(
  app: Awaited<ReturnType<typeof buildApp>>,
  cookie: string,
  jobId: string,
  ai: BlockingAwardConfidenceAiClient
) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    ai.releaseAll();
    const response = await app.inject({ method: "GET", url: `/award-confidence/jobs/${jobId}`, headers: { cookie } });
    expect(response.statusCode).toBe(200);
    const payload = response.json();
    if (payload.job.status === "completed" || payload.job.status === "failed" || payload.job.status === "cancelled") return payload;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Award confidence job did not finish");
}
