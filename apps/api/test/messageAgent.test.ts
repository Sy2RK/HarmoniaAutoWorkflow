import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import { buildApp } from "../src/app.js";
import { NoopAiClient } from "../src/ai/client.js";
import type { MessageAgentDraftGenerationInput, MessageAgentTemplateExtractionInput } from "../src/ai/client.js";
import { hashPassword } from "../src/auth/session.js";
import type { Env } from "../src/config/env.js";
import { InMemoryRepository } from "../src/db/memory.js";
import type { GraphMailClient } from "../src/graph/client.js";
import type { OutboundMailer } from "../src/mail/outbound.js";

const youthOrg = "\u56e2\u7ec4\u7ec7";
const leagueApplication = "\u5165\u56e2\u5fd7\u613f\u4e66";
const smartLeague = "\u667a\u6167\u56e2\u5efa";
const facilityHeader = "\u7ef4\u62a4";
const electricityHeader = "\u9001\u7535";
const functionRoomHeader = "\u529f\u80fd\u623f";
const propertyStaffHeader = "\u7269\u4e1a\u4eba\u5458";
const formatHeader = "\u683c\u5f0f";

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

describe("message agent backend", () => {
  it("uploads the common workbook, ignores temp files, and extracts first-version template categories", async () => {
    const fixture = await createApp();
    try {
      const session = await createSession(fixture.app, fixture.cookie);
      const upload = await uploadFiles(fixture.app, fixture.cookie, session.id, "reference", [
        {
          name: "files",
          filename: "common-library.xlsx",
          contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          value: commonLibraryWorkbook()
        },
        {
          name: "files",
          filename: "~$temp.docx",
          contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          value: await minimalDocx("temp")
        }
      ]);
      expect(upload.statusCode, upload.body).toBe(200);
      expect(upload.json().warnings).toContain("IGNORED_TEMP_FILE:~$temp.docx");
      expectNoStoragePath(upload.json().sources);
      expect(upload.json().uploadProgress).toMatchObject({ active: false, phase: "completed", role: "reference", totalFiles: 2, processedFiles: 2 });
      expect(fixture.messageAgentAi.templateCalls.length).toBeGreaterThan(0);

      const detail = await fixture.app.inject({ method: "GET", url: `/message-agent/sessions/${session.id}`, headers: { cookie: fixture.cookie } });
      expect(detail.statusCode).toBe(200);
      expectNoStoragePath(detail.json().sources);
      expect(detail.json().uploadProgress).toMatchObject({ active: false, phase: "completed", processedFiles: 2 });
      const categories = new Set((detail.json().templates as Array<{ category: string }>).map((item) => item.category));
      for (const category of ["facility_notice", "youth_league", "electricity_subsidy", "function_room", "property_staff", "bfmo_coordination", "format_reminder"]) {
        expect(categories.has(category)).toBe(true);
      }
    } finally {
      await fixture.cleanup();
    }
  });

  it("records .msg and old .doc as unsupported", async () => {
    const fixture = await createApp();
    try {
      const session = await createSession(fixture.app, fixture.cookie);
      const upload = await uploadFiles(fixture.app, fixture.cookie, session.id, "reference", [
        { name: "files", filename: "mail.msg", contentType: "application/vnd.ms-outlook", value: Buffer.from("msg") },
        { name: "files", filename: "legacy.doc", contentType: "application/msword", value: Buffer.from("doc") }
      ]);
      expect(upload.statusCode).toBe(200);
      expectNoStoragePath(upload.json().sources);
      expect(upload.json().sources.map((source: { status: string }) => source.status)).toEqual(["unsupported", "unsupported"]);
      expect(upload.json().sources.flatMap((source: { warnings: string[] }) => source.warnings).join("\n")).toContain("UNSUPPORTED_FILE_TYPE");
    } finally {
      await fixture.cleanup();
    }
  });

  it("parses DOCX examples, extracts Outlook PDF Portfolio attachments, and marks shell-only PDF as low-quality", async () => {
    const fixture = await createApp();
    try {
      const session = await createSession(fixture.app, fixture.cookie);
      const embeddedText = Array.from({ length: 35 }, () => "Harmonia College Office electricity subsidy allocation notice for residents.").join(" ");
      const upload = await uploadFiles(fixture.app, fixture.cookie, session.id, "reference", [
        {
          name: "files",
          filename: "electricity.docx",
          contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          value: await minimalDocx("Notice on electricity subsidy allocation\n\nHarmonia College Office\nPlease verify the annual allocation details.")
        },
        {
          name: "files",
          filename: "electricity-portfolio.pdf",
          contentType: "application/pdf",
          value: pdfPortfolioWithAttachment("embedded-electricity.pdf", minimalPdf([embeddedText]))
        },
        { name: "files", filename: "shell-only.pdf", contentType: "application/pdf", value: minimalPdf(["For best experience, open this PDF Portfolio in Acrobat."]) }
      ]);
      expect(upload.statusCode).toBe(200);
      const sources = upload.json().sources as Array<{ fileName: string; status: string; text: string; warnings: string[] }>;
      expect(sources.find((source) => source.fileName === "electricity.docx")?.text.length).toBeGreaterThan(20);
      const portfolio = sources.find((source) => source.fileName === "electricity-portfolio.pdf");
      expect(portfolio?.status).toBe("ready");
      expect(portfolio?.text).toContain("Harmonia College Office");
      expect(portfolio?.text.length).toBeGreaterThan(50);
      expect(portfolio?.warnings).toContain("PDF_PORTFOLIO_EMBEDDED_PDF_EXTRACTED");
      expect(portfolio?.warnings).not.toContain("PDF_PORTFOLIO_TEXT_NOT_EXTRACTED");
      const shellOnly = sources.find((source) => source.fileName === "shell-only.pdf");
      expect(shellOnly?.status).toBe("partial");
      expect(shellOnly?.warnings).toContain("PDF_PORTFOLIO_TEXT_NOT_EXTRACTED");
      const categories = new Set((upload.json().templates as Array<{ category: string }>).map((item) => item.category));
      expect(categories.has("electricity_subsidy")).toBe(true);
    } finally {
      await fixture.cleanup();
    }
  });

  it("asks follow-up questions for a facility notice missing location, date, and time", async () => {
    const fixture = await createApp();
    try {
      const session = await createSeededSession(fixture);
      const chat = await fixture.app.inject({
        method: "POST",
        url: `/message-agent/sessions/${session.id}/chat`,
        headers: { cookie: fixture.cookie },
        payload: { message: "Please draft a maintenance notice.", mode: "fast" }
      });
      expect(chat.statusCode).toBe(200);
      expect(chat.json().draft).toBeNull();
      const questions = (chat.json().followUpQuestions as Array<{ slotKey: string }>).map((item) => item.slotKey);
      expect(questions).toEqual(expect.arrayContaining(["location", "date", "time"]));
      expect(chat.json().assistantMessage.metadata.followUpQuestions).toHaveLength(chat.json().followUpQuestions.length);
    } finally {
      await fixture.cleanup();
    }
  });

  it("retrieves function-room and youth-league templates and generates editable plain-text drafts", async () => {
    const fixture = await createApp();
    try {
      const session = await createSeededSession(fixture);
      const functionRoomPrompt = "A student entered function room B203 early and missed sign-in. Please reply that the missed sign-in record is cancelled.";
      const functionRoom = await fixture.app.inject({
        method: "POST",
        url: `/message-agent/sessions/${session.id}/chat`,
        headers: { cookie: fixture.cookie },
        payload: {
          message: functionRoomPrompt,
          mode: "fast"
        }
      });
      expect(functionRoom.statusCode).toBe(200);
      expect(functionRoom.json().draft.body).toContain("Harmonia College Office");
      expect(functionRoom.json().draft.sourceRefs).toHaveLength(functionRoom.json().sources.length);
      expectNoStoragePath(functionRoom.json().sources);
      expect((functionRoom.json().sources as Array<{ category: string }>).some((source) => source.category === "function_room")).toBe(true);
      expect(countOccurrences(fixture.messageAgentAi.draftCalls.at(-1)?.context ?? "", functionRoomPrompt)).toBe(1);

      const youthLeague = await fixture.app.inject({
        method: "POST",
        url: `/message-agent/sessions/${session.id}/chat`,
        headers: { cookie: fixture.cookie },
        payload: {
          message: `${youthOrg} transfer document missing for name Zhang San. Please ask the student to submit ${leagueApplication}.`,
          mode: "fast"
        }
      });
      expect(youthLeague.statusCode).toBe(200);
      expect(youthLeague.json().draft.plainText).toContain("Subject:");
      expect((youthLeague.json().sources as Array<{ category: string }>).some((source) => source.category === "youth_league")).toBe(true);
    } finally {
      await fixture.cleanup();
    }
  });

  it("persists manual draft edits and exports edited DOCX content with only matched source refs", async () => {
    const fixture = await createApp();
    try {
      const session = await createSeededSession(fixture);
      const chat = await fixture.app.inject({
        method: "POST",
        url: `/message-agent/sessions/${session.id}/chat`,
        headers: { cookie: fixture.cookie },
        payload: { message: "Please draft a maintenance notice for Block D water dispenser maintenance on 2026-06-20 from 10:00 to 12:00.", mode: "fast" }
      });
      expect(chat.statusCode).toBe(200);
      expect(chat.json().draft).toBeTruthy();

      const edit = await fixture.app.inject({
        method: "PATCH",
        url: `/message-agent/sessions/${session.id}/draft`,
        headers: { cookie: fixture.cookie },
        payload: { subject: "Edited Subject", body: "Edited body\nHarmonia College Office" }
      });
      expect(edit.statusCode).toBe(200);
      expect(edit.json().draft.plainText).toContain("Edited Subject");

      const docx = await fixture.app.inject({
        method: "GET",
        url: `/message-agent/sessions/${session.id}/draft.docx`,
        headers: { cookie: fixture.cookie }
      });
      expect(docx.statusCode).toBe(200);
      const zip = await JSZip.loadAsync(docx.rawPayload);
      const documentXml = await zip.file("word/document.xml")?.async("string");
      expect(documentXml).toContain("Edited Subject");
      expect(documentXml).toContain("Edited body");
      expect(documentXml).not.toContain("youth");
    } finally {
      await fixture.cleanup();
    }
  });

  it("clears chat messages without deleting templates, sources, or the latest draft", async () => {
    const fixture = await createApp();
    try {
      const session = await createSeededSession(fixture);
      const chat = await fixture.app.inject({
        method: "POST",
        url: `/message-agent/sessions/${session.id}/chat`,
        headers: { cookie: fixture.cookie },
        payload: { message: "Please draft a maintenance notice for Block D water dispenser maintenance on 2026-06-20 from 10:00 to 12:00.", mode: "fast" }
      });
      expect(chat.statusCode).toBe(200);

      const clear = await fixture.app.inject({
        method: "DELETE",
        url: `/message-agent/sessions/${session.id}/messages`,
        headers: { cookie: fixture.cookie }
      });
      expect(clear.statusCode).toBe(200);
      expect(clear.json().messages).toEqual([]);
      expect(clear.json().latestDraft).toBeTruthy();
      expect(clear.json().sources.length).toBeGreaterThan(0);
      expect(clear.json().templates.length).toBeGreaterThan(0);
      expect(clear.json().session.messageCount).toBe(0);
      expect(clear.json().session.latestDraftId).toBe(chat.json().draft.id);

      const detail = await fixture.app.inject({ method: "GET", url: `/message-agent/sessions/${session.id}`, headers: { cookie: fixture.cookie } });
      expect(detail.statusCode).toBe(200);
      expect(detail.json().messages).toEqual([]);
      expect(detail.json().latestDraft.id).toBe(chat.json().draft.id);
    } finally {
      await fixture.cleanup();
    }
  });

  it("rejects non-image files sent as chat image attachments", async () => {
    const fixture = await createApp();
    try {
      const session = await createSession(fixture.app, fixture.cookie);
      const boundary = "message-agent-chat-boundary";
      const response = await fixture.app.inject({
        method: "POST",
        url: `/message-agent/sessions/${session.id}/chat`,
        headers: { ...multipartHeaders(boundary), cookie: fixture.cookie },
        payload: multipartBody(boundary, [
          { name: "message", value: "Please read this image." },
          { name: "images", filename: "not-an-image.txt", contentType: "text/plain", value: Buffer.from("not image") }
        ])
      });
      expect(response.statusCode).toBe(400);
      expect(response.body).toContain("MESSAGE_AGENT_UNSUPPORTED_CHAT_IMAGE");
    } finally {
      await fixture.cleanup();
    }
  });
});

function expectNoStoragePath(items: unknown): void {
  expect(Array.isArray(items)).toBe(true);
  for (const item of items as Array<Record<string, unknown>>) {
    expect(item).not.toHaveProperty("storagePath");
  }
}

function countOccurrences(value: string, search: string): number {
  return value.split(search).length - 1;
}

class FakeMessageAgentAi extends NoopAiClient {
  readonly draftCalls: MessageAgentDraftGenerationInput[] = [];
  readonly templateCalls: MessageAgentTemplateExtractionInput[] = [];

  async extractMessageAgentTemplate(input: MessageAgentTemplateExtractionInput) {
    this.templateCalls.push(input);
    return {
      category: input.categoryHint,
      title: input.sourceTitle,
      language: "zh" as const,
      audience: "student" as const,
      subjectPattern: null,
      bodySkeleton: input.text,
      requiredSlots: [],
      optionalSlots: [],
      tone: "polite college-office tone",
      signatureStyle: null
    };
  }

  async generateMessageAgentDraft(input: MessageAgentDraftGenerationInput) {
    this.draftCalls.push(input);
    return {
      subject: `Draft ${input.category}`,
      body: `Dear student,\n\nGenerated draft for ${input.category}. Please verify details.\n\nBest regards,\nHarmonia College Office`,
      attachmentSuggestions: [],
      warnings: []
    };
  }
}

async function createApp() {
  const storageRoot = await mkdtemp(join(tmpdir(), "message-agent-test-"));
  const repo = new InMemoryRepository("public@example.edu.cn");
  await repo.ensureAdminUser(env.ADMIN_EMAIL, await hashPassword(env.ADMIN_PASSWORD));
  const messageAgentAi = new FakeMessageAgentAi();
  const app = await buildApp({
    env,
    repo,
    ai: new NoopAiClient(),
    messageAgentAi,
    mailer,
    graph,
    attachmentRoot: env.ATTACHMENT_STORAGE_DIR,
    messageAgentStorageRoot: storageRoot
  });
  const cookie = await loginCookie(app);
  return {
    app,
    cookie,
    storageRoot,
    messageAgentAi,
    async cleanup() {
      await app.close();
      await rm(storageRoot, { recursive: true, force: true });
    }
  };
}

async function createSession(app: Awaited<ReturnType<typeof buildApp>>, cookie: string) {
  const response = await app.inject({ method: "POST", url: "/message-agent/sessions", headers: { cookie } });
  expect(response.statusCode).toBe(200);
  return response.json().session as { id: string };
}

async function createSeededSession(fixture: Awaited<ReturnType<typeof createApp>>) {
  const session = await createSession(fixture.app, fixture.cookie);
  const upload = await uploadFiles(fixture.app, fixture.cookie, session.id, "reference", [
    {
      name: "files",
      filename: "common-library.xlsx",
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      value: commonLibraryWorkbook()
    }
  ]);
  expect(upload.statusCode, upload.body).toBe(200);
  return session;
}

async function loginCookie(app: Awaited<ReturnType<typeof buildApp>>): Promise<string> {
  const login = await app.inject({ method: "POST", url: "/auth/login", payload: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD } });
  expect(login.statusCode).toBe(200);
  return String(login.headers["set-cookie"]);
}

async function uploadFiles(app: Awaited<ReturnType<typeof buildApp>>, cookie: string, sessionId: string, role: string, parts: MultipartTestPart[]) {
  const boundary = `message-agent-${Math.random().toString(16).slice(2)}`;
  return app.inject({
    method: "POST",
    url: `/message-agent/sessions/${sessionId}/files`,
    headers: { ...multipartHeaders(boundary), cookie },
    payload: multipartBody(boundary, [{ name: "fileRole", value: role }, ...parts])
  });
}

function commonLibraryWorkbook(): Buffer {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([
    [facilityHeader, youthOrg, electricityHeader, functionRoomHeader, propertyStaffHeader, "BFMO", formatHeader],
    [
      "Harmonia College Facilities Maintenance Notice. Block D water dispenser maintenance on 2026-06-20 from 10:00 to 12:00.",
      `${youthOrg} transfer reply. Ask the student to submit ${leagueApplication} in ${smartLeague}.`,
      "Notice on electricity subsidy allocation at Harmonia College. Annual kWh allocation notice.",
      "Function room B203 reservation and missed sign-in reply. The missed sign-in record can be cancelled.",
      "Property staff and cleaning service feedback reply. Explain the handling progress.",
      "BFMO Buildings and Facilities coordination request for construction schedule and facility support.",
      "Email format reminder. Please include salutation, body, closing, and signature."
    ]
  ]);
  XLSX.utils.book_append_sheet(workbook, worksheet, "Library");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

async function minimalDocx(text: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("word/document.xml", `<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>${escapeXml(text)}</w:t></w:r></w:p></w:body></w:document>`);
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
    objects[contentId] = `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`;
  });
  objects[fontId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  return assemblePdf(objects);
}

function pdfPortfolioWithAttachment(fileName: string, attachment: Buffer): Buffer {
  const objects: string[] = [];
  objects[1] = `<< /Type /Catalog /Pages 2 0 R /Names << /EmbeddedFiles << /Names [(${escapePdfText(fileName)}) 6 0 R] >> >> >>`;
  objects[2] = "<< /Type /Pages /Kids [3 0 R] /Count 1 >>";
  objects[3] = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>";
  const shellText = "For best experience, open this PDF Portfolio in Acrobat.";
  const stream = `BT /F1 18 Tf 48 120 Td (${escapePdfText(shellText)}) Tj ET`;
  objects[4] = `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`;
  objects[5] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  objects[6] = `<< /Type /Filespec /F (${escapePdfText(fileName)}) /UF (${escapePdfText(fileName)}) /EF << /F 7 0 R /UF 7 0 R >> >>`;
  objects[7] = `<< /Type /EmbeddedFile /Subtype /application#2Fpdf /Length ${attachment.length} >>\nstream\n${attachment.toString("latin1")}\nendstream`;
  return assemblePdf(objects);
}

function assemblePdf(objects: string[]): Buffer {
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (let id = 1; id < objects.length; id += 1) {
    if (!objects[id]) continue;
    offsets[id] = Buffer.byteLength(pdf, "latin1");
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) pdf += `${String(offsets[id] ?? 0).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
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
