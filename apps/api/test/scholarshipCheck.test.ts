import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/auth/session.js";
import { NoopAiClient } from "../src/ai/client.js";
import type { AiClient, ScholarshipEvidenceVerificationInput } from "../src/ai/client.js";
import { matchEvidenceForApplicant, parseEvidencePath } from "../src/scholarship-check/evidence.js";
import { buildCheckResult, buildRemark } from "../src/scholarship-check/remarks.js";
import { buildAiVerifiedCheckResult, buildAiVerifiedRemark, evidenceToImages } from "../src/scholarship-check/verifier.js";
import { parseApplicants, outputColumns, writeProcessedWorkbook } from "../src/scholarship-check/workbook.js";
import { ScholarshipCheckService, scholarshipCheckStorageRoot } from "../src/scholarship-check/service.js";
import { InMemoryRepository } from "../src/db/memory.js";
import type { Env } from "../src/config/env.js";
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

const testScholarshipStorageRoot = scholarshipCheckStorageRoot("storage/scholarship-check-test");

describe("scholarship check core", () => {
  it("maps source workbook columns to processed workbook columns", async () => {
    const sourcePath = join(process.cwd(), "../../storage/scholarship-check-test-source.xlsx");
    const outputPath = join(process.cwd(), "../../storage/scholarship-check-test-output.xlsx");
    try {
      await writeFile(sourcePath, minimalWorkbook());
      const applicants = parseApplicants(sourcePath);
      expect(applicants).toHaveLength(1);
      expect(applicants[0]).toMatchObject({ name: "张三", studentId: "2026001" });

      writeProcessedWorkbook(
        applicants.slice(0, 1),
        new Map([
          [
            applicants[0]!.rowNumber,
            {
              remark: "书院贡献：无问题\n学生组织：无问题\n社会服务与实践：无问题\n奖项：无问题",
              detail: "书院贡献：材料一致。\n学生组织：材料一致。\n社会服务与实践：材料一致。\n奖项：材料一致。"
            }
          ]
        ]),
        outputPath
      );
      const workbook = XLSX.readFile(outputPath);
      const rows = XLSX.utils.sheet_to_json<Array<string | number>>(workbook.Sheets[workbook.SheetNames[0]!]!, { header: 1, defval: "" });
      expect(rows[0]).toEqual([...outputColumns]);
      expect(rows[1]?.[12]).toBe("无违纪记录");
      expect(String(rows[1]?.[14])).toContain("书院贡献：无问题");
      expect(String(rows[1]?.[15])).toContain("书院贡献：材料一致。");
    } finally {
      await rm(sourcePath, { force: true });
      await rm(outputPath, { force: true });
    }
  });

  it("formats remarks as exactly four ordered lines", () => {
    const remark = buildRemark({
      collegeContribution: { declaredText: "", evidence: [] },
      studentOrganization: { declaredText: "1、2024-01-01; 学生会; 部长; 有证明", evidence: [] },
      socialPractice: {
        declaredText: "1、2024-01-01; 支教; 志愿者; 有证明\n\n2、2024-02-01; 实习; 实习生; 有证明",
        evidence: [parseEvidencePath("root/张三附件(证明材料)/社会服务与实践/支教.pdf", "/tmp/支教.pdf", "application/pdf")]
      },
      award: {
        declaredText: "1、2024-01-01; 大学; 奖项; 有证明",
        evidence: [parseEvidencePath("root/张三附件(证明材料)/奖项/奖项.pdf", "/tmp/奖项.pdf", "application/pdf")]
      }
    });

    expect(remark.split("\n")).toEqual(["书院贡献：未填写", "学生组织：无证明材料", "社会服务与实践：部分材料缺失", "奖项：无问题"]);
  });

  it("formats structured remarks and details as four ordered lines", () => {
    const result = buildCheckResult({
      collegeContribution: { declaredText: "", evidence: [] },
      studentOrganization: { declaredText: "1、2024-01-01; 学生会; 部长; 有证明", evidence: [] },
      socialPractice: {
        declaredText: "1、2024-01-01; 支教; 志愿者; 有证明\n\n2、2024-02-01; 实习; 实习生; 有证明",
        evidence: [parseEvidencePath("root/张三附件(证明材料)/社会服务与实践/支教.pdf", "/tmp/支教.pdf", "application/pdf")]
      },
      award: {
        declaredText: "1、2024-01-01; 大学; 奖项; 有证明",
        evidence: [parseEvidencePath("root/张三附件(证明材料)/奖项/奖项.pdf", "/tmp/奖项.pdf", "application/pdf")]
      }
    });

    expect(result.remark.split("\n")).toEqual(["书院贡献：未填写", "学生组织：无证明材料", "社会服务与实践：部分材料缺失", "奖项：无问题"]);
    expect(result.detail.split("\n")).toHaveLength(4);
    expect(result.detail).toContain("社会服务与实践：申报 2 项，找到 1 个证明文件");
  });

  it("matches Chinese and English applicant folders", () => {
    const applicants = [
      { rowNumber: 2, values: {}, name: "张三", studentId: "1", categories: { collegeContribution: "", studentOrganization: "", socialPractice: "", award: "" } },
      {
        rowNumber: 3,
        values: {},
        name: "ANNABEL LEONARDI",
        studentId: "2",
        categories: { collegeContribution: "", studentOrganization: "", socialPractice: "", award: "" }
      }
    ];
    const evidence = [
      parseEvidencePath("root/张三附件(证明材料)/奖项/a.pdf", "/tmp/a.pdf", "application/pdf"),
      parseEvidencePath("root/ANNABEL LEONARDI附件(证明材料)/学生组织/b.pdf", "/tmp/b.pdf", "application/pdf")
    ];

    expect(matchEvidenceForApplicant(applicants[0]!, evidence)).toHaveLength(1);
    expect(matchEvidenceForApplicant(applicants[1]!, evidence)).toHaveLength(1);
  });

  it("uses the deepest attachment folder as the applicant name", () => {
    const record = parseEvidencePath(
      "祥波书院优秀毕业生附件(证明材料)_2026-03-30/ANNABEL LEONARDI附件(证明材料)/奖项/a.pdf",
      "/tmp/a.pdf",
      "application/pdf"
    );

    expect(record.applicantName).toBe("ANNABEL LEONARDI");
    expect(matchEvidenceForApplicant(
      {
        rowNumber: 3,
        values: {},
        name: "ANNABEL LEONARDI",
        studentId: "2",
        categories: { collegeContribution: "", studentOrganization: "", socialPractice: "", award: "" }
      },
      [record]
    )).toHaveLength(1);
  });

  it("renders every PDF page before model verification", async () => {
    const pdfPath = join(process.cwd(), "../../storage/scholarship-check-test-two-page.pdf");
    try {
      await writeFile(pdfPath, minimalPdf(["Page 1", "Page 2"]));
      const record = parseEvidencePath("root/张三附件(证明材料)/奖项/sample.pdf", pdfPath, "application/pdf");
      const result = await evidenceToImages([record], { pdfImageWidth: 400 });

      expect(result.failedFiles).toBe(0);
      expect(result.images).toHaveLength(2);
      expect(result.images.map((image) => image.pageNumber)).toEqual([1, 2]);
      expect(result.images.every((image) => image.dataUrl.startsWith("data:image/png;base64,"))).toBe(true);
    } finally {
      await rm(pdfPath, { force: true });
    }
  });

  it("does not swallow pause and cancel signals between model batches", async () => {
    const pngPath = join(process.cwd(), "../../storage/scholarship-check-test-signal.png");
    const ai = new FakeScholarshipAiClient();
    try {
      await writeFile(pngPath, Buffer.from("png"));
      await expect(
        buildAiVerifiedRemark({
          ai,
          applicant: {
            rowNumber: 2,
            values: {},
            name: "张三",
            studentId: "2026001",
            categories: {
              collegeContribution: "",
              studentOrganization: "",
              socialPractice: "",
              award: "1、2024-01-01; 大学; 奖项; 有证明"
            }
          },
          evidenceByCategory: {
            collegeContribution: [],
            studentOrganization: [],
            socialPractice: [],
            award: [parseEvidencePath("root/张三附件(证明材料)/奖项/award.png", pngPath, "image/png")]
          },
          options: {
            beforeModelRequest: () => {
              throw new Error("SCHOLARSHIP_CHECK_PAUSED");
            }
          }
        })
      ).rejects.toThrow("SCHOLARSHIP_CHECK_PAUSED");
      expect(ai.calls).toHaveLength(0);
    } finally {
      await rm(pngPath, { force: true });
    }
  });

  it("maps AI mismatch and missing results to fixed remark statuses with details", async () => {
    const pngPath = join(process.cwd(), "../../storage/scholarship-check-test-ai-map.png");
    try {
      await writeFile(pngPath, Buffer.from("png"));
      const applicant = {
        rowNumber: 2,
        values: {},
        name: "张三",
        studentId: "2026001",
        categories: {
          collegeContribution: "",
          studentOrganization: "",
          socialPractice: "1、支教; 志愿者; 有证明\n2、实习; 实习生; 有证明",
          award: "1、大学; 奖项; 有证明"
        }
      };
      const result = await buildAiVerifiedCheckResult({
        ai: new SequenceScholarshipAiClient([
          { supported: true, confidence: 0.9, summary: "", issues: [], matchedItems: ["支教"], missingItems: ["实习"] },
          { supported: false, confidence: 0.9, summary: "", issues: ["奖项名称与申报内容不一致"], matchedItems: [], missingItems: [] }
        ]),
        applicant,
        evidenceByCategory: {
          collegeContribution: [],
          studentOrganization: [],
          socialPractice: [parseEvidencePath("root/张三附件(证明材料)/社会服务与实践/a.png", pngPath, "image/png")],
          award: [parseEvidencePath("root/张三附件(证明材料)/奖项/b.png", pngPath, "image/png")]
        }
      });

      expect(result.remark.split("\n")).toEqual(["书院贡献：未填写", "学生组织：未填写", "社会服务与实践：部分材料缺失", "奖项：部分材料不匹配"]);
      expect(result.detail).toContain("社会服务与实践：已匹配：支教；缺少：实习");
      expect(result.detail).toContain("奖项：奖项名称与申报内容不一致");
    } finally {
      await rm(pngPath, { force: true });
    }
  });

  it("treats minor naming and date differences as supported when core evidence matches", async () => {
    const pngPath = join(process.cwd(), "../../storage/scholarship-check-test-ai-lenient.png");
    try {
      await writeFile(pngPath, Buffer.from("png"));
      const applicant = {
        rowNumber: 2,
        values: {},
        name: "张三",
        studentId: "2026001",
        categories: {
          collegeContribution: "",
          studentOrganization: "1、2023-2024; 祥波书院学生组织; 副部长; 有证明",
          socialPractice: "1、2024; 笃行志远; 志愿者; 有证明",
          award: "1、2023-2024; Academic Performance Scholarship Tier 3; 有证明"
        }
      };
      const result = await buildAiVerifiedCheckResult({
        ai: new SequenceScholarshipAiClient([
          {
            supported: true,
            confidence: 0.86,
            summary: "",
            issues: ["角色名称显示为 Vice Chair，与申报副部长属于近义表述差异。"],
            matchedItems: ["祥波书院学生组织"],
            missingItems: []
          },
          {
            supported: true,
            confidence: 0.9,
            summary: "",
            issues: ["申报项目名称为笃行志远，证书显示为笃行致远，存在一字之差，疑似笔误。"],
            matchedItems: ["笃行志远"],
            missingItems: []
          },
          {
            supported: true,
            confidence: 0.92,
            summary: "",
            issues: ["证明材料未显示具体落款日期，但奖项名称和学年基本一致。"],
            matchedItems: ["Academic Performance Scholarship Tier 3"],
            missingItems: []
          }
        ]),
        applicant,
        evidenceByCategory: {
          collegeContribution: [],
          studentOrganization: [parseEvidencePath("root/张三附件(证明材料)/学生组织/org.png", pngPath, "image/png")],
          socialPractice: [parseEvidencePath("root/张三附件(证明材料)/社会服务与实践/service.png", pngPath, "image/png")],
          award: [parseEvidencePath("root/张三附件(证明材料)/奖项/award.png", pngPath, "image/png")]
        }
      });

      expect(result.remark.split("\n")).toEqual(["书院贡献：未填写", "学生组织：无问题", "社会服务与实践：无问题", "奖项：无问题"]);
      expect(result.detail).toContain("核心信息匹配，轻微差异不影响通过");
      expect(result.detail).toContain("一字之差");
      expect(result.detail).toContain("具体落款日期");
    } finally {
      await rm(pngPath, { force: true });
    }
  });
});

describe("scholarship check service recovery", () => {
  it("auto-resumes legacy restart-paused jobs after service restart", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "scholarship-check-restart-"));
    const jobId = "restart-scholarship-check";
    const rootDir = join(storageRoot, jobId);
    const inputDir = join(rootDir, "input");
    const workbookPath = join(inputDir, "workbook.xlsx");
    const createdAt = new Date("2026-01-01T00:00:00.000Z").toISOString();
    const restartPauseMessage = "\u4efb\u52a1\u56e0\u670d\u52a1\u91cd\u542f\u5df2\u6682\u505c\uff0c\u53ef\u70b9\u51fb\u7ee7\u7eed\u6062\u590d\u3002";

    try {
      await mkdir(inputDir, { recursive: true });
      await writeFile(workbookPath, minimalWorkbook());
      await writeFile(join(rootDir, "evidence.json"), JSON.stringify([]));
      const rows = parseApplicants(workbookPath).map((applicant) => ({
        rowNumber: applicant.rowNumber,
        name: applicant.name,
        studentId: applicant.studentId,
        status: "processing",
        remark: null,
        detail: null,
        error: null,
        editedAt: null,
        editedBy: null
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
              totalApplicants: rows.length,
              processedApplicants: 0,
              error: restartPauseMessage,
              mode: "dry_run",
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

      const service = new ScholarshipCheckService(storageRoot, new NoopAiClient());
      const completed = await waitForScholarshipServiceJob(service, jobId, "completed");

      expect(completed.job.status).toBe("completed");
      expect(completed.job.error).toBeNull();
      expect(completed.rows.every((row) => row.status === "completed")).toBe(true);
    } finally {
      await rm(storageRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});

describe("scholarship check routes", () => {
  it("allows browser preflight for scholarship mutation routes", async () => {
    const app = await testApp();

    try {
      const response = await app.inject({
        method: "OPTIONS",
        url: "/scholarship-check/jobs/00000000-0000-4000-8000-000000000000",
        headers: {
          origin: env.WEB_ORIGIN,
          "access-control-request-method": "DELETE"
        }
      });
      expect(response.statusCode).toBe(204);
      expect(response.headers["access-control-allow-origin"]).toBe(env.WEB_ORIGIN);
      expect(response.headers["access-control-allow-methods"]).toContain("DELETE");
      expect(response.headers["access-control-allow-methods"]).toContain("PATCH");

      const localhostAlias = await app.inject({
        method: "OPTIONS",
        url: "/scholarship-check/jobs/00000000-0000-4000-8000-000000000000",
        headers: {
          origin: "http://127.0.0.1:5173",
          "access-control-request-method": "DELETE"
        }
      });
      expect(localhostAlias.statusCode).toBe(204);
      expect(localhostAlias.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:5173");
      expect(localhostAlias.headers["access-control-allow-methods"]).toContain("DELETE");
    } finally {
      await app.close();
    }
  });

  it("rejects invalid uploads and unknown result downloads", async () => {
    const app = await testApp();
    const cookie = await loginCookie(app);

    const missingWorkbook = await app.inject({
      method: "POST",
      url: "/scholarship-check/jobs",
      headers: { ...multipartHeaders("x"), cookie },
      payload: multipartBody("x", [{ name: "evidencePaths", value: "[]" }])
    });
    expect(missingWorkbook.statusCode).toBe(400);
    expect(missingWorkbook.json()).toMatchObject({ error: "WORKBOOK_REQUIRED" });

    const missingPaths = await app.inject({
      method: "POST",
      url: "/scholarship-check/jobs",
      headers: { ...multipartHeaders("y"), cookie },
      payload: multipartBody("y", [
        { name: "workbook", filename: "input.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", value: minimalWorkbook() },
        { name: "evidenceFiles", filename: "proof.pdf", contentType: "application/pdf", value: Buffer.from("pdf") }
      ])
    });
    expect(missingPaths.statusCode).toBe(400);
    expect(missingPaths.json()).toMatchObject({ error: "EVIDENCE_PATHS_REQUIRED" });

    const nonXlsx = await app.inject({
      method: "POST",
      url: "/scholarship-check/jobs",
      headers: { ...multipartHeaders("z"), cookie },
      payload: multipartBody("z", [
        { name: "workbook", filename: "input.txt", contentType: "text/plain", value: Buffer.from("not excel") },
        { name: "evidenceFiles", filename: "proof.pdf", contentType: "application/pdf", value: Buffer.from("pdf") },
        { name: "evidencePaths", value: JSON.stringify(["root/张三附件(证明材料)/奖项/proof.pdf"]) }
      ])
    });
    expect(nonXlsx.statusCode).toBe(400);
    expect(nonXlsx.json()).toMatchObject({ error: "WORKBOOK_MUST_BE_XLSX" });

    const unknown = await app.inject({
      method: "GET",
      url: "/scholarship-check/jobs/00000000-0000-4000-8000-000000000000/result",
      headers: { cookie }
    });
    expect(unknown.statusCode).toBe(404);
    await app.close();
  });

  it("creates a background job and downloads a completed workbook", async () => {
    const app = await testApp();
    const cookie = await loginCookie(app);
    const boundary = "success";
    const evidencePaths = [
      "root/张三附件(证明材料)/书院贡献/contribution.pdf",
      "root/张三附件(证明材料)/学生组织/org.pdf",
      "root/张三附件(证明材料)/奖项/award.pdf"
    ];
    const create = await app.inject({
      method: "POST",
      url: "/scholarship-check/jobs",
      headers: { ...multipartHeaders(boundary), cookie },
      payload: multipartBody(boundary, [
        { name: "workbook", filename: "input.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", value: minimalWorkbook() },
        { name: "evidenceFiles", filename: "contribution.pdf", contentType: "application/pdf", value: Buffer.from("pdf") },
        { name: "evidenceFiles", filename: "org.pdf", contentType: "application/pdf", value: Buffer.from("pdf") },
        { name: "evidenceFiles", filename: "award.pdf", contentType: "application/pdf", value: Buffer.from("pdf") },
        { name: "evidencePaths", value: JSON.stringify(evidencePaths) },
        { name: "mode", value: "dry_run" }
      ])
    });
    expect(create.statusCode).toBe(200);
    const jobId = create.json().job.id as string;

    try {
      const completed = await waitForJob(app, cookie, jobId);
      expect(completed.job.status).toBe("completed");
      expect(completed.rows[0].remark.split("\n")).toHaveLength(4);
      expect(completed.rows[0].detail.split("\n")).toHaveLength(4);

      const result = await app.inject({
        method: "GET",
        url: `/scholarship-check/jobs/${jobId}/result`,
        headers: { cookie }
      });
      expect(result.statusCode).toBe(200);
      expect(result.headers["content-type"]).toContain("spreadsheetml.sheet");
      expect(result.body.length).toBeGreaterThan(1000);
    } finally {
      await rm(join(testScholarshipStorageRoot, jobId), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      await app.close();
    }
  });

  it("calls the scholarship AI verifier in default ai mode", async () => {
    const ai = new FakeScholarshipAiClient();
    const app = await testApp(ai);
    const cookie = await loginCookie(app);
    const boundary = "ai-mode";
    const evidencePaths = [
      "root/张三附件(证明材料)/书院贡献/contribution.png",
      "root/张三附件(证明材料)/学生组织/org.png",
      "root/张三附件(证明材料)/奖项/award.png"
    ];
    const create = await app.inject({
      method: "POST",
      url: "/scholarship-check/jobs",
      headers: { ...multipartHeaders(boundary), cookie },
      payload: multipartBody(boundary, [
        { name: "workbook", filename: "input.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", value: minimalWorkbook() },
        { name: "evidenceFiles", filename: "contribution.png", contentType: "image/png", value: Buffer.from("png") },
        { name: "evidenceFiles", filename: "org.png", contentType: "image/png", value: Buffer.from("png") },
        { name: "evidenceFiles", filename: "award.png", contentType: "image/png", value: Buffer.from("png") },
        { name: "evidencePaths", value: JSON.stringify(evidencePaths) }
      ])
    });
    expect(create.statusCode).toBe(200);
    const jobId = create.json().job.id as string;

    try {
      const completed = await waitForJob(app, cookie, jobId);
      expect(completed.job.status).toBe("completed");
      expect(ai.calls.length).toBeGreaterThanOrEqual(3);
      expect(ai.calls.every((call) => call.images.length === 1)).toBe(true);
      expect(ai.calls.every((call) => call.images[0]?.dataUrl.startsWith("data:image/png;base64,"))).toBe(true);
    } finally {
      await rm(join(testScholarshipStorageRoot, jobId), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      await app.close();
    }
  });

  it("accepts upload filenames with path separators and removes temp upload batches", async () => {
    const app = await testApp();
    const cookie = await loginCookie(app);
    const boundary = "unsafe-upload-name";
    const create = await app.inject({
      method: "POST",
      url: "/scholarship-check/jobs",
      headers: { ...multipartHeaders(boundary), cookie },
      payload: multipartBody(boundary, [
        { name: "workbook", filename: "..\\input.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", value: minimalWorkbook() },
        { name: "evidenceFiles", filename: "../award.pdf", contentType: "application/pdf", value: Buffer.from("pdf") },
        { name: "evidencePaths", value: JSON.stringify(["root/张三附件(证明材料)/奖项/award.pdf"]) },
        { name: "mode", value: "dry_run" }
      ])
    });
    expect(create.statusCode).toBe(200);
    const jobId = create.json().job.id as string;

    try {
      const completed = await waitForJob(app, cookie, jobId);
      expect(completed.job.status).toBe("completed");
      await expectTmpUploadsCleaned();
    } finally {
      await rm(join(testScholarshipStorageRoot, jobId), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      await app.close();
    }
  });

  it("lists and retains the five most recent jobs", async () => {
    const app = await testApp();
    const cookie = await loginCookie(app);
    const ids: string[] = [];

    try {
      for (let index = 0; index < 6; index += 1) {
        const boundary = `retention-${index}`;
        const create = await app.inject({
          method: "POST",
          url: "/scholarship-check/jobs",
          headers: { ...multipartHeaders(boundary), cookie },
          payload: multipartBody(boundary, [
            { name: "workbook", filename: `input-${index}.xlsx`, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", value: minimalWorkbook() },
            { name: "evidenceFiles", filename: "award.pdf", contentType: "application/pdf", value: Buffer.from("pdf") },
            { name: "evidencePaths", value: JSON.stringify(["root/寮犱笁闄勪欢(璇佹槑鏉愭枡)/濂栭」/award.pdf"]) },
            { name: "mode", value: "dry_run" }
          ])
        });
        expect(create.statusCode).toBe(200);
        const jobId = create.json().job.id as string;
        ids.push(jobId);
        await waitForJob(app, cookie, jobId);
      }

      const list = await app.inject({ method: "GET", url: "/scholarship-check/jobs?limit=5", headers: { cookie } });
      expect(list.statusCode).toBe(200);
      const payload = list.json();
      expect(payload.items).toHaveLength(5);
      expect(payload.total).toBe(5);
      expect(payload.items.map((item: { id: string }) => item.id)).toEqual(ids.slice(1).reverse());

      const old = await app.inject({ method: "GET", url: `/scholarship-check/jobs/${ids[0]}`, headers: { cookie } });
      expect(old.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it("updates row remarks and persists the edit", async () => {
    const app = await testApp();
    const cookie = await loginCookie(app);
    const boundary = "edit-row";
    const create = await app.inject({
      method: "POST",
      url: "/scholarship-check/jobs",
      headers: { ...multipartHeaders(boundary), cookie },
      payload: multipartBody(boundary, [
        { name: "workbook", filename: "input.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", value: minimalWorkbook() },
        { name: "evidenceFiles", filename: "award.pdf", contentType: "application/pdf", value: Buffer.from("pdf") },
        { name: "evidencePaths", value: JSON.stringify(["root/寮犱笁闄勪欢(璇佹槑鏉愭枡)/濂栭」/award.pdf"]) },
        { name: "mode", value: "dry_run" }
      ])
    });
    const jobId = create.json().job.id as string;

    try {
      const completed = await waitForJob(app, cookie, jobId);
      const editedRemark = "书院贡献：部分材料缺失\n学生组织：无证明材料\n社会服务与实践：未填写\n奖项：无证明材料";
      const editedDetail = "书院贡献：人工复核后确认仍缺少活动证明。\n学生组织：未找到学生组织证明。\n社会服务与实践：申请表该栏为空。\n奖项：未找到奖项证明。";
      const update = await app.inject({
        method: "PATCH",
        url: `/scholarship-check/jobs/${jobId}/rows/${completed.rows[0].rowNumber}`,
        headers: { cookie },
        payload: { remark: editedRemark, detail: editedDetail }
      });
      expect(update.statusCode).toBe(200);
      expect(update.json().row).toMatchObject({ remark: editedRemark, detail: editedDetail, status: "completed" });
      expect(update.json().row.editedAt).toBeTruthy();

      const detail = await app.inject({ method: "GET", url: `/scholarship-check/jobs/${jobId}`, headers: { cookie } });
      expect(detail.json().rows[0].remark).toBe(editedRemark);
      expect(detail.json().rows[0].detail).toBe(editedDetail);

      const result = await app.inject({ method: "GET", url: `/scholarship-check/jobs/${jobId}/result`, headers: { cookie } });
      expect(result.statusCode).toBe(200);
      const workbook = XLSX.read(result.rawPayload, { type: "buffer" });
      const rows = XLSX.utils.sheet_to_json<Array<string | number>>(workbook.Sheets[workbook.SheetNames[0]!]!, { header: 1, defval: "" });
      expect(rows[0]).toContain("核对情况备注");
      expect(rows[0]).toContain("详细情况");
      expect(String(rows[1]?.[14])).toBe(editedRemark);
      expect(String(rows[1]?.[15])).toBe(editedDetail);
    } finally {
      await rm(join(testScholarshipStorageRoot, jobId), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      await app.close();
    }
  });

  it("pauses and resumes an in-flight ai job", async () => {
    const app = await testApp();
    const cookie = await loginCookie(app);
    const boundary = "pause-resume";
    const create = await app.inject({
      method: "POST",
      url: "/scholarship-check/jobs",
      headers: { ...multipartHeaders(boundary), cookie },
      payload: multipartBody(boundary, [
        { name: "workbook", filename: "input.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", value: minimalWorkbook() },
        { name: "evidenceFiles", filename: "award.png", contentType: "image/png", value: Buffer.from("png") },
        { name: "evidencePaths", value: JSON.stringify(["root/张三附件(证明材料)/奖项/award.png"]) }
      ])
    });
    expect(create.statusCode).toBe(200);
    const jobId = create.json().job.id as string;

    try {
      const pause = await app.inject({ method: "POST", url: `/scholarship-check/jobs/${jobId}/pause`, headers: { cookie } });
      expect(pause.statusCode).toBe(200);
      expect(pause.json().job.status).toBe("paused");
      await waitForStatus(app, cookie, jobId, "paused");

      const resume = await app.inject({ method: "POST", url: `/scholarship-check/jobs/${jobId}/resume`, headers: { cookie } });
      expect(resume.statusCode).toBe(200);
      const completed = await waitForJob(app, cookie, jobId);
      expect(completed.job.status).toBe("completed");
    } finally {
      await rm(join(testScholarshipStorageRoot, jobId), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      await app.close();
    }
  });

  it("cancels an in-flight ai job and downloads a partial workbook", async () => {
    const ai = new BlockingScholarshipAiClient();
    const app = await testApp(ai);
    const cookie = await loginCookie(app);
    const boundary = "cancel";
    const create = await app.inject({
      method: "POST",
      url: "/scholarship-check/jobs",
      headers: { ...multipartHeaders(boundary), cookie },
      payload: multipartBody(boundary, [
        { name: "workbook", filename: "input.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", value: minimalWorkbook() },
        { name: "evidenceFiles", filename: "award.png", contentType: "image/png", value: Buffer.from("png") },
        { name: "evidencePaths", value: JSON.stringify(["root/寮犱笁闄勪欢(璇佹槑鏉愭枡)/濂栭」/award.png"]) }
      ])
    });
    const jobId = create.json().job.id as string;

    try {
      const cancel = await app.inject({ method: "POST", url: `/scholarship-check/jobs/${jobId}/cancel`, headers: { cookie } });
      expect(cancel.statusCode).toBe(200);
      expect(cancel.json().job.status).toBe("cancelled");
      const cancelled = await waitForStatus(app, cookie, jobId, "cancelled");
      expect(cancelled.rows[0].status).toBe("cancelled");
      expect(cancelled.rows[0].remark).toBeTruthy();

      const result = await app.inject({ method: "GET", url: `/scholarship-check/jobs/${jobId}/result`, headers: { cookie } });
      expect(result.statusCode).toBe(200);
      expect(result.headers["content-type"]).toContain("spreadsheetml.sheet");
    } finally {
      await rm(join(testScholarshipStorageRoot, jobId), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      await app.close();
    }
  });

  it("deletes an in-flight ai job without recreating the record", async () => {
    const ai = new BlockingScholarshipAiClient();
    const app = await testApp(ai);
    const cookie = await loginCookie(app);
    const boundary = "delete-active";
    const evidencePaths = [
      "root/张三附件(证明材料)/书院贡献/contribution.png",
      "root/张三附件(证明材料)/学生组织/org.png",
      "root/张三附件(证明材料)/奖项/award.png"
    ];
    const create = await app.inject({
      method: "POST",
      url: "/scholarship-check/jobs",
      headers: { ...multipartHeaders(boundary), cookie },
      payload: multipartBody(boundary, [
        { name: "workbook", filename: "input.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", value: minimalWorkbook() },
        { name: "evidenceFiles", filename: "contribution.png", contentType: "image/png", value: Buffer.from("png") },
        { name: "evidenceFiles", filename: "org.png", contentType: "image/png", value: Buffer.from("png") },
        { name: "evidenceFiles", filename: "award.png", contentType: "image/png", value: Buffer.from("png") },
        { name: "evidencePaths", value: JSON.stringify(evidencePaths) }
      ])
    });
    expect(create.statusCode).toBe(200);
    const jobId = create.json().job.id as string;

    try {
      await waitUntil(() => ai.calls.length > 0);

      const deleted = await app.inject({ method: "DELETE", url: `/scholarship-check/jobs/${jobId}`, headers: { cookie } });
      expect(deleted.statusCode).toBe(200);
      expect(deleted.json()).toEqual({ ok: true });
      await expectJobDeleted(app, cookie, jobId);

      ai.release();
      await expectJobDeleted(app, cookie, jobId);
    } finally {
      ai.release();
      await rm(join(testScholarshipStorageRoot, jobId), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      await app.close();
    }
  });
});

async function testApp(ai: AiClient = new NoopAiClient()) {
  await rm(testScholarshipStorageRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  const repo = new InMemoryRepository("public@example.edu.cn");
  await repo.ensureAdminUser(env.ADMIN_EMAIL, await hashPassword(env.ADMIN_PASSWORD));
  return buildApp({ env, repo, ai, scholarshipAi: ai, scholarshipCheckStorageRoot: testScholarshipStorageRoot, mailer, graph, attachmentRoot: "storage/attachments" });
}

class FakeScholarshipAiClient extends NoopAiClient {
  readonly calls: ScholarshipEvidenceVerificationInput[] = [];

  async verifyScholarshipEvidence(input: ScholarshipEvidenceVerificationInput) {
    this.calls.push(input);
    return {
      supported: true,
      confidence: 0.9,
      summary: "材料支持申报内容",
      issues: [],
      matchedItems: ["已匹配"],
      missingItems: []
    };
  }
}

class SequenceScholarshipAiClient extends NoopAiClient {
  readonly calls: ScholarshipEvidenceVerificationInput[] = [];

  constructor(
    private readonly responses: Array<{
      supported: boolean;
      confidence: number;
      summary: string;
      issues: string[];
      matchedItems: string[];
      missingItems: string[];
    }>
  ) {
    super();
  }

  async verifyScholarshipEvidence(input: ScholarshipEvidenceVerificationInput) {
    this.calls.push(input);
    return this.responses.shift() ?? null;
  }
}

class BlockingScholarshipAiClient extends FakeScholarshipAiClient {
  private releaseCurrent: (() => void) | null = null;

  async verifyScholarshipEvidence(input: ScholarshipEvidenceVerificationInput) {
    this.calls.push(input);
    await new Promise<void>((resolve) => {
      this.releaseCurrent = resolve;
    });
    return {
      supported: true,
      confidence: 0.9,
      summary: "鏉愭枡鏀寔鐢虫姤鍐呭",
      issues: [],
      matchedItems: ["matched"],
      missingItems: []
    };
  }

  release() {
    this.releaseCurrent?.();
    this.releaseCurrent = null;
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

function minimalWorkbook(): Buffer {
  const rows = [
    ["序号", "姓名", "性别", "学号", "入学年度", "学院", "宿舍号", "专业", "电话号码", "个人陈述", "书院贡献", "社会服务与实践", "学业表现", "学生组织", "奖项"],
    [
      1,
      "张三",
      "男",
      "2026001",
      "2022",
      "经管学院",
      "A101",
      "会计学",
      "13800000000",
      "个人陈述",
      "1、2024-01-01; 书院活动; 志愿者; 有证明",
      "无",
      "CGPA：3.9",
      "1、2024-01-01; 学生会; 部长; 有证明",
      "1、2024-01-01; 大学; 奖项; 有证明"
    ]
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Export");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function minimalPdf(pageTexts: string[]): Buffer {
  const pageIds = pageTexts.map((_, index) => 3 + index * 2);
  const contentIds = pageTexts.map((_, index) => 4 + index * 2);
  const fontId = 3 + pageTexts.length * 2;
  const objects: string[] = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  pageTexts.forEach((text, index) => {
    const pageId = pageIds[index]!;
    const contentId = contentIds[index]!;
    const stream = `BT /F1 24 Tf 48 120 Td (${escapePdfText(text)}) Tj ET`;
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 180] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}\nendstream`;
  });
  objects[fontId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (let id = 1; id < objects.length; id += 1) {
    if (!objects[id]) continue;
    offsets[id] = Buffer.byteLength(pdf, "ascii");
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, "ascii");
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) {
    pdf += `${String(offsets[id] ?? 0).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "ascii");
}

function escapePdfText(value: string): string {
  return value.replace(/[()\\]/g, (match) => `\\${match}`);
}

function multipartHeaders(boundary: string): Record<string, string> {
  return { "content-type": `multipart/form-data; boundary=${boundary}` };
}

type MultipartTestPart =
  | { name: string; value: string }
  | { name: string; filename: string; contentType: string; value: Buffer };

function multipartBody(boundary: string, parts: MultipartTestPart[]): Buffer {
  const chunks: Buffer[] = [];
  for (const part of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    if ("filename" in part) {
      chunks.push(
        Buffer.from(`Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\nContent-Type: ${part.contentType}\r\n\r\n`)
      );
      chunks.push(part.value);
      chunks.push(Buffer.from("\r\n"));
    } else {
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="${part.name}"\r\n\r\n${part.value}\r\n`));
    }
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(chunks);
}

async function waitForJob(app: Awaited<ReturnType<typeof buildApp>>, cookie: string, jobId: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await app.inject({ method: "GET", url: `/scholarship-check/jobs/${jobId}`, headers: { cookie } });
    expect(response.statusCode).toBe(200);
    const payload = response.json();
    if (payload.job.status === "completed" || payload.job.status === "failed" || payload.job.status === "cancelled") return payload;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Job did not complete");
}

async function waitForStatus(app: Awaited<ReturnType<typeof buildApp>>, cookie: string, jobId: string, status: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await app.inject({ method: "GET", url: `/scholarship-check/jobs/${jobId}`, headers: { cookie } });
    expect(response.statusCode).toBe(200);
    const payload = response.json();
    if (payload.job.status === status) return payload;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Job did not reach ${status}`);
}

async function waitForScholarshipServiceJob(service: ScholarshipCheckService, jobId: string, status: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const payload = await service.getJob(jobId);
    expect(payload).toBeTruthy();
    if (payload?.job.status === status) return payload;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Scholarship check service job did not reach ${status}`);
}

async function expectJobDeleted(app: Awaited<ReturnType<typeof buildApp>>, cookie: string, jobId: string) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const detail = await app.inject({ method: "GET", url: `/scholarship-check/jobs/${jobId}`, headers: { cookie } });
    expect(detail.statusCode).toBe(404);

    const result = await app.inject({ method: "GET", url: `/scholarship-check/jobs/${jobId}/result`, headers: { cookie } });
    expect(result.statusCode).toBe(404);

    const list = await app.inject({ method: "GET", url: "/scholarship-check/jobs?limit=5", headers: { cookie } });
    expect(list.statusCode).toBe(200);
    expect((list.json().items as Array<{ id: string }>).map((item) => item.id)).not.toContain(jobId);
    expect(existsSync(join(testScholarshipStorageRoot, jobId))).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function expectTmpUploadsCleaned() {
  const entries = await readdir(join(testScholarshipStorageRoot, "tmp")).catch(() => []);
  expect(entries).toHaveLength(0);
}

async function waitUntil(predicate: () => boolean) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Condition was not met");
}
