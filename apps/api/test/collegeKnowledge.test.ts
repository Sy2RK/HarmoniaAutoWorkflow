import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import { buildApp } from "../src/app.js";
import { NoopAiClient } from "../src/ai/client.js";
import type { CollegeKnowledgeAnswerInput, CollegeKnowledgeRerankInput } from "../src/ai/client.js";
import { hashPassword } from "../src/auth/session.js";
import { CollegeKnowledgeService } from "../src/college-knowledge/service.js";
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

describe("college knowledge backend", () => {
  it("uploads documents, ignores temp files, indexes xlsx FAQ rows, and answers with trusted sources", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "college-knowledge-api-"));
    const repo = new InMemoryRepository("public@example.edu.cn");
    await repo.ensureAdminUser(env.ADMIN_EMAIL, await hashPassword(env.ADMIN_PASSWORD));
    const ai = new FakeCollegeKnowledgeAi();
    const app = await buildApp({
      env,
      repo,
      ai: new NoopAiClient(),
      collegeKnowledgeAi: ai,
      mailer,
      graph,
      attachmentRoot: env.ATTACHMENT_STORAGE_DIR,
      collegeKnowledgeStorageRoot: storageRoot
    });
    try {
      const cookie = await loginCookie(app);
      const boundary = "college-upload";
      const upload = await app.inject({
        method: "POST",
        url: "/college-knowledge/documents/upload",
        headers: { ...multipartHeaders(boundary), cookie },
        payload: multipartBody(boundary, [
          {
            name: "files",
            filename: "faq.xlsx",
            contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            value: faqWorkbook()
          },
          {
            name: "files",
            filename: "~$faq.xlsx",
            contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            value: Buffer.from("temp")
          },
          { name: "relativePaths", value: JSON.stringify(["policies/faq.xlsx", "policies/~$faq.xlsx"]) }
        ])
      });
      expect(upload.statusCode, upload.body).toBe(200);
      expect(upload.json()).toMatchObject({ total: 1, ignored: 1 });

      const documents = await repo.listCollegeKnowledgeDocuments();
      expect(documents).toHaveLength(1);
      expect(documents[0]).toMatchObject({ status: "ready", fileName: "faq.xlsx", chunkCount: 2 });
      const chunks = await repo.listCollegeKnowledgeChunks(documents[0]!.id);
      expect(chunks.map((chunk) => chunk.locator)).toContain("FAQ!R2");
      expect(chunks.map((chunk) => chunk.locator)).toContain("FAQ!R3");

      const chat = await app.inject({
        method: "POST",
        url: "/college-knowledge/chat",
        headers: { cookie },
        payload: { question: "住宿期限是多少？" }
      });
      expect(chat.statusCode).toBe(200);
      expect(chat.json()).toMatchObject({ answerable: true });
      expect(chat.json().answer).toContain("2026");
      expect(chat.json().sources[0]).toMatchObject({ documentName: "faq.xlsx", locator: "FAQ!R2" });
      expect(ai.rerankInputs).toHaveLength(1);
      expect(ai.answerInputs[0]?.sources[0]?.id).toBe(chat.json().sources[0].id);
    } finally {
      await app.close();
      await rm(storageRoot, { recursive: true, force: true });
    }
  });

  it("records old doc/ppt as unsupported without breaking other uploads", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "college-knowledge-unsupported-"));
    const repo = new InMemoryRepository("public@example.edu.cn");
    const service = new CollegeKnowledgeService(repo, new FakeCollegeKnowledgeAi(), storageRoot);
    const tempDir = await mkdtemp(join(tmpdir(), "college-knowledge-input-"));
    try {
      const docPath = join(tempDir, "legacy.doc");
      await writeFile(docPath, Buffer.from("legacy"));
      const result = await service.uploadFiles([{ tempPath: docPath, fileName: "legacy.doc", contentType: "application/msword", relativePath: "legacy.doc" }]);
      expect(result.documents[0]).toMatchObject({ status: "unsupported", chunkCount: 0 });
      expect(await repo.listCollegeKnowledgeChunks(result.documents[0]!.id)).toHaveLength(0);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
      await rm(storageRoot, { recursive: true, force: true });
    }
  });

  it("extracts PDF page locators, docx chunks, and pptx slide locators", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "college-knowledge-parsers-"));
    const repo = new InMemoryRepository("public@example.edu.cn");
    const service = new CollegeKnowledgeService(repo, new FakeCollegeKnowledgeAi(), storageRoot);
    const tempDir = await mkdtemp(join(tmpdir(), "college-knowledge-parser-input-"));
    try {
      const pdfPath = join(tempDir, "guide.pdf");
      const docxPath = join(tempDir, "guide.docx");
      const pptxPath = join(tempDir, "slides.pptx");
      await writeFile(pdfPath, minimalPdf(["College guide page one", "Dorm policy page two"]));
      await writeFile(docxPath, await minimalDocx("导师预约需要提前三个工作日提交。"));
      await writeFile(pptxPath, await minimalPptx(["Slide one intro", "第二页说明宿舍门禁时间。"]));

      await service.uploadFiles([
        { tempPath: pdfPath, fileName: "guide.pdf", contentType: "application/pdf", relativePath: "guide.pdf" },
        {
          tempPath: docxPath,
          fileName: "guide.docx",
          contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          relativePath: "guide.docx"
        },
        {
          tempPath: pptxPath,
          fileName: "slides.pptx",
          contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          relativePath: "slides.pptx"
        }
      ]);
      const documents = await repo.listCollegeKnowledgeDocuments();
      const allChunks = await repo.listCollegeKnowledgeChunks();
      expect(documents.map((document) => document.status)).toEqual(["ready", "ready", "ready"]);
      expect(allChunks.map((chunk) => chunk.locator)).toContain("page 2");
      expect(allChunks.map((chunk) => chunk.locator)).toContain("docx");
      expect(allChunks.map((chunk) => chunk.locator)).toContain("slide 2");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
      await rm(storageRoot, { recursive: true, force: true });
    }
  });

  it("reindexes from stored originals and delete removes retrieval sources", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "college-knowledge-reindex-"));
    const repo = new InMemoryRepository("public@example.edu.cn");
    const service = new CollegeKnowledgeService(repo, new FakeCollegeKnowledgeAi(), storageRoot);
    const tempDir = await mkdtemp(join(tmpdir(), "college-knowledge-reindex-input-"));
    try {
      const mdPath = join(tempDir, "policy.md");
      await writeFile(mdPath, "# Policy\n\nOriginal dorm rule.", "utf8");
      const result = await service.uploadFiles([{ tempPath: mdPath, fileName: "policy.md", contentType: "text/markdown", relativePath: "policy.md" }]);
      const document = result.documents[0]!;
      await writeFile(document.storagePath, "# Policy\n\nUpdated dorm rule for 2026.", "utf8");

      const reindexed = await service.reindexDocument(document.id);
      expect(reindexed).toMatchObject({ status: "ready", chunkCount: 1 });
      const chunks = await repo.listCollegeKnowledgeChunks(document.id);
      expect(chunks[0]?.text).toContain("Updated dorm rule for 2026");

      const deleted = await service.deleteDocument(document.id);
      expect(deleted).toBe(true);
      expect(await repo.listCollegeKnowledgeDocuments()).toHaveLength(0);
      expect(await repo.listCollegeKnowledgeChunks()).toHaveLength(0);
      await expect(readdir(join(storageRoot, "documents", document.id))).rejects.toThrow();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
      await rm(storageRoot, { recursive: true, force: true });
    }
  });

  it("returns not answerable when lexical retrieval finds no source", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "college-knowledge-no-answer-"));
    const repo = new InMemoryRepository("public@example.edu.cn");
    const service = new CollegeKnowledgeService(repo, new FakeCollegeKnowledgeAi(), storageRoot);
    const tempDir = await mkdtemp(join(tmpdir(), "college-knowledge-no-answer-input-"));
    try {
      const mdPath = join(tempDir, "policy.md");
      await writeFile(mdPath, "# Dorm\n\n住宿期限到 2026 年 6 月。", "utf8");
      await service.uploadFiles([{ tempPath: mdPath, fileName: "policy.md", contentType: "text/markdown", relativePath: "policy.md" }]);
      const response = await service.chat({ question: "火星基地申请流程是什么？", images: [] });
      expect(response).toMatchObject({ answerable: false, sources: [] });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
      await rm(storageRoot, { recursive: true, force: true });
    }
  });

  it("uses image extraction text in multipart chat before retrieval", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "college-knowledge-image-"));
    const repo = new InMemoryRepository("public@example.edu.cn");
    await repo.ensureAdminUser(env.ADMIN_EMAIL, await hashPassword(env.ADMIN_PASSWORD));
    const ai = new FakeCollegeKnowledgeAi();
    const tempDir = await mkdtemp(join(tmpdir(), "college-knowledge-image-input-"));
    const app = await buildApp({
      env,
      repo,
      ai: new NoopAiClient(),
      collegeKnowledgeAi: ai,
      mailer,
      graph,
      attachmentRoot: env.ATTACHMENT_STORAGE_DIR,
      collegeKnowledgeStorageRoot: storageRoot
    });
    try {
      const mdPath = join(tempDir, "policy.md");
      await writeFile(mdPath, "# Dorm\n\n住宿期限到 2026 年 6 月。", "utf8");
      const service = new CollegeKnowledgeService(repo, ai, storageRoot);
      await service.uploadFiles([{ tempPath: mdPath, fileName: "policy.md", contentType: "text/markdown", relativePath: "policy.md" }]);

      const cookie = await loginCookie(app);
      const boundary = "college-image-chat";
      const chat = await app.inject({
        method: "POST",
        url: "/college-knowledge/chat",
        headers: { ...multipartHeaders(boundary), cookie },
        payload: multipartBody(boundary, [
          { name: "question", value: "图里问的政策是什么？" },
          { name: "images", filename: "question.png", contentType: "image/png", value: Buffer.from([0x89, 0x50, 0x4e, 0x47]) }
        ])
      });
      expect(chat.statusCode).toBe(200);
      expect(chat.json()).toMatchObject({ answerable: true });
      expect(ai.imageInputs).toHaveLength(1);
      expect(ai.imageInputs[0]?.contentType).toBe("image/png");
      expect(ai.answerInputs[0]?.imageText).toContain("住宿期限");
    } finally {
      await app.close();
      await rm(tempDir, { recursive: true, force: true });
      await rm(storageRoot, { recursive: true, force: true });
    }
  });
});

class FakeCollegeKnowledgeAi extends NoopAiClient {
  readonly rerankInputs: CollegeKnowledgeRerankInput[] = [];
  readonly answerInputs: CollegeKnowledgeAnswerInput[] = [];
  readonly imageInputs: Array<{ filePath: string; contentType: string }> = [];

  async describeCollegeKnowledgeImage(input: { filePath: string; contentType: string }): Promise<string | null> {
    this.imageInputs.push(input);
    return "图片中提到住宿期限。";
  }

  async rerankCollegeKnowledge(input: CollegeKnowledgeRerankInput) {
    this.rerankInputs.push(input);
    const selectedIds = input.candidates
      .filter((candidate) => /住宿期限|住宿|dorm/i.test(candidate.text + input.question + (input.imageText ?? "")))
      .map((candidate) => candidate.id)
      .slice(0, 8);
    return { selectedIds: selectedIds.length ? selectedIds : input.candidates.slice(0, 3).map((candidate) => candidate.id), reasons: {} };
  }

  async answerCollegeKnowledge(input: CollegeKnowledgeAnswerInput) {
    this.answerInputs.push(input);
    const matching = input.sources.filter((source) => /住宿期限|住宿|dorm/i.test(source.text + input.question + (input.imageText ?? "")));
    if (!matching.length) {
      return { answerable: false, answer: "未找到依据。", sourceIds: [], warnings: [] };
    }
    return {
      answerable: true,
      answer: "住宿期限到 2026 年 6 月。",
      sourceIds: matching.slice(0, 2).map((source) => source.id),
      warnings: []
    };
  }
}

async function loginCookie(app: Awaited<ReturnType<typeof buildApp>>): Promise<string> {
  const login = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD }
  });
  expect(login.statusCode).toBe(200);
  return String(login.headers["set-cookie"]);
}

function faqWorkbook(): Buffer {
  const workbook = XLSX.utils.book_new();
  const rows = [
    ["问题", "答案", "类别"],
    ["住宿期限是多少？", "住宿期限到 2026 年 6 月。", "住宿"],
    ["导师预约怎么提交？", "导师预约需要提前三个工作日提交。", "导师"]
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "FAQ");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

async function minimalDocx(text: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("word/document.xml", `<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>${escapeXml(text)}</w:t></w:r></w:p></w:body></w:document>`);
  return zip.generateAsync({ type: "nodebuffer" });
}

async function minimalPptx(slides: string[]): Promise<Buffer> {
  const zip = new JSZip();
  slides.forEach((slide, index) => {
    zip.file(`ppt/slides/slide${index + 1}.xml`, `<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><a:t>${escapeXml(slide)}</a:t></p:cSld></p:sld>`);
  });
  return zip.generateAsync({ type: "nodebuffer" });
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
    const stream = `BT /F1 18 Tf 48 120 Td (${escapePdfText(text)}) Tj ET`;
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`;
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

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapePdfText(value: string): string {
  return value.replace(/[()\\]/g, (match) => `\\${match}`);
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
