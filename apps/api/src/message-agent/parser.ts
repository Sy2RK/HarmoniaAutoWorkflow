import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { PDFParse } from "pdf-parse";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import type { MessageAgentFileStatus, MessageAgentTemplateCategory } from "@harmonia/shared";

export type MessageAgentTemplateSeed = {
  title: string;
  category: MessageAgentTemplateCategory;
  text: string;
  locator: string;
};

export type ParsedMessageAgentFile = {
  text: string;
  status: MessageAgentFileStatus;
  warnings: string[];
  templateSeeds: MessageAgentTemplateSeed[];
};

const supportedExtensions = new Set([".xlsx", ".xls", ".docx", ".pdf", ".md", ".txt", ".csv"]);
const unsupportedExtensions = new Set([".msg", ".doc"]);
const maxEmbeddedPdfDepth = 2;

export async function parseMessageAgentFile(input: { filePath: string; fileName: string }): Promise<ParsedMessageAgentFile> {
  const ext = extname(input.fileName).toLowerCase();
  if (unsupportedExtensions.has(ext)) {
    return {
      text: "",
      status: "unsupported",
      warnings: [`UNSUPPORTED_FILE_TYPE:${ext}`],
      templateSeeds: []
    };
  }
  if (!supportedExtensions.has(ext)) {
    return {
      text: "",
      status: "unsupported",
      warnings: [`UNSUPPORTED_FILE_TYPE:${ext || "unknown"}`],
      templateSeeds: []
    };
  }
  switch (ext) {
    case ".xlsx":
    case ".xls":
    case ".csv":
      return parseWorkbook(input.filePath, input.fileName);
    case ".docx":
      return parseDocx(input.filePath, input.fileName);
    case ".pdf":
      return parsePdf(input.filePath, input.fileName);
    case ".md":
    case ".txt": {
      const text = normalizeText(await readFile(input.filePath, "utf8"));
      return { text, status: text ? "ready" : "failed", warnings: text ? [] : ["NO_EXTRACTABLE_TEXT"], templateSeeds: text ? [seedFromText(input.fileName, text)] : [] };
    }
    default:
      return { text: "", status: "unsupported", warnings: [`UNSUPPORTED_FILE_TYPE:${ext}`], templateSeeds: [] };
  }
}

async function parseWorkbook(filePath: string, fileName: string): Promise<ParsedMessageAgentFile> {
  const workbook = XLSX.read(await readFile(filePath), { type: "buffer", cellDates: false, raw: false });
  const seeds: MessageAgentTemplateSeed[] = [];
  const sections: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) continue;
    const rows = XLSX.utils.sheet_to_json<Array<string | number | boolean>>(worksheet, { header: 1, defval: "", raw: false });
    const headers = rows[0]?.map((cell) => normalizeCell(cell)) ?? [];
    rows.slice(1).forEach((row, rowIndex) => {
      row.forEach((cell, columnIndex) => {
        const text = normalizeText(normalizeCell(cell));
        if (!text) return;
        const header = headers[columnIndex] ?? "";
        const category = categoryFromHeader(header);
        const rowNumber = rowIndex + 2;
        const title = firstLine(text) || `${header || "通用模板"} ${rowNumber}`;
        const locator = `${sheetName}!R${rowNumber}C${columnIndex + 1}`;
        seeds.push({ title, category, text, locator });
        sections.push(`## ${header || "通用格式提醒"} ${locator}\n\n${text}`);
      });
    });
  }
  const text = sections.join("\n\n").trim();
  return {
    text,
    status: seeds.length ? "ready" : "failed",
    warnings: seeds.length ? [] : ["NO_TEMPLATE_CELLS_EXTRACTED"],
    templateSeeds: seeds.map((seed) => ({ ...seed, title: titleFromFileAndSeed(fileName, seed) }))
  };
}

async function parseDocx(filePath: string, fileName: string): Promise<ParsedMessageAgentFile> {
  const zip = await JSZip.loadAsync(await readFile(filePath));
  const documentXml = await zip.file("word/document.xml")?.async("string");
  if (!documentXml) return { text: "", status: "failed", warnings: ["DOCX_DOCUMENT_XML_NOT_FOUND"], templateSeeds: [] };
  const paragraphs = documentXml
    .split(/<\/w:p>/g)
    .map((paragraph) => extractXmlTexts(paragraph, "w:t").join(""))
    .map(normalizeText)
    .filter(Boolean);
  const text = paragraphs.join("\n\n");
  return {
    text,
    status: text ? "ready" : "failed",
    warnings: text ? [] : ["NO_EXTRACTABLE_TEXT"],
    templateSeeds: text ? [seedFromText(fileName, text)] : []
  };
}

async function parsePdf(filePath: string, fileName: string): Promise<ParsedMessageAgentFile> {
  return parsePdfBuffer(await readFile(filePath), fileName, 0);
}

async function parsePdfBuffer(data: Buffer, fileName: string, depth: number): Promise<ParsedMessageAgentFile> {
  const { text, warnings: textWarnings } = await extractPdfText(data);
  const warnings = [...textWarnings];
  const shellOnly = portfolioShellText(text);
  const embedded = depth < maxEmbeddedPdfDepth ? await extractEmbeddedPdfTexts(data, fileName, depth, warnings) : [];
  if (embedded.length > 0) {
    const embeddedText = embedded.map((item) => `## ${item.fileName}\n\n${item.text}`).join("\n\n");
    warnings.push("PDF_PORTFOLIO_EMBEDDED_PDF_EXTRACTED");
    return {
      text: normalizeText(embeddedText),
      status: "ready",
      warnings,
      templateSeeds: embedded.map((item) => ({
        title: firstLine(item.text) || item.fileName,
        category: categoryFromText(`${item.fileName}\n${item.text}`),
        text: item.text,
        locator: `${fileName} > ${item.fileName}`
      }))
    };
  }

  if (shellOnly) warnings.push("PDF_PORTFOLIO_TEXT_NOT_EXTRACTED");
  if (!text) warnings.push("NO_EXTRACTABLE_TEXT");
  const highQuality = text && !shellOnly;
  return {
    text,
    status: highQuality ? "ready" : text ? "partial" : "failed",
    warnings,
    templateSeeds: highQuality ? [seedFromText(fileName, text)] : []
  };
}

async function extractPdfText(data: Buffer): Promise<{ text: string; warnings: string[] }> {
  const parser = new PDFParse({ data });
  try {
    const result = await parser.getText();
    return { text: normalizeText(result.text ?? ""), warnings: [] };
  } catch (error) {
    return { text: "", warnings: [error instanceof Error ? `PDF_TEXT_EXTRACTION_FAILED:${error.message}` : "PDF_TEXT_EXTRACTION_FAILED"] };
  } finally {
    await parser.destroy();
  }
}

async function extractEmbeddedPdfTexts(
  data: Buffer,
  fileName: string,
  depth: number,
  warnings: string[]
): Promise<Array<{ fileName: string; text: string }>> {
  const attachments = await extractPdfAttachments(data, warnings);
  const parsed: Array<{ fileName: string; text: string }> = [];
  for (const attachment of attachments) {
    if (!isPdfBuffer(attachment.content)) {
      if (attachment.fileName.toLowerCase().endsWith(".msg")) warnings.push(`PDF_PORTFOLIO_UNSUPPORTED_ATTACHMENT:${attachment.fileName}`);
      continue;
    }
    const result = await parsePdfBuffer(attachment.content, attachment.fileName, depth + 1);
    if (result.text && result.status !== "failed" && !portfolioShellText(result.text)) {
      parsed.push({ fileName: attachment.fileName, text: result.text });
      warnings.push(...result.warnings.filter((warning) => warning !== "PDF_PORTFOLIO_EMBEDDED_PDF_EXTRACTED"));
    } else if (result.warnings.length > 0) {
      warnings.push(...result.warnings.map((warning) => `${attachment.fileName}:${warning}`));
    } else {
      warnings.push(`PDF_PORTFOLIO_ATTACHMENT_TEXT_NOT_EXTRACTED:${attachment.fileName}`);
    }
  }
  return parsed;
}

async function extractPdfAttachments(data: Buffer, warnings: string[]): Promise<Array<{ fileName: string; content: Buffer }>> {
  try {
    const loadingTask = getDocument({ data: new Uint8Array(data) });
    const document = await loadingTask.promise;
    try {
      const rawAttachments = (await document.getAttachments()) as Record<string, PdfJsAttachment> | null;
      if (!rawAttachments) return [];
      return Object.entries(rawAttachments)
        .map(([key, attachment]) => ({
          fileName: safeAttachmentName(attachment.filename || key),
          content: Buffer.from(attachment.content ?? [])
        }))
        .filter((attachment) => attachment.content.length > 0);
    } finally {
      await document.destroy();
    }
  } catch (error) {
    warnings.push(error instanceof Error ? `PDF_PORTFOLIO_ATTACHMENT_EXTRACTION_FAILED:${error.message}` : "PDF_PORTFOLIO_ATTACHMENT_EXTRACTION_FAILED");
    return [];
  }
}

type PdfJsAttachment = {
  filename?: string;
  content?: Uint8Array | number[];
};

function seedFromText(fileName: string, text: string): MessageAgentTemplateSeed {
  return {
    title: firstLine(text) || fileName,
    category: categoryFromText(`${fileName}\n${text}`),
    text,
    locator: fileName
  };
}

function categoryFromHeader(header: string): MessageAgentTemplateCategory {
  if (/物业施工|维护|施工|消杀|清洗|窗帘|饮水机|水箱|漏水/.test(header)) return "facility_notice";
  if (/团组织|团员|团/.test(header)) return "youth_league";
  if (/送电|电费|电/.test(header)) return "electricity_subsidy";
  if (/功能房|房间|预约/.test(header)) return "function_room";
  if (/物业人员|保洁|物业/.test(header)) return "property_staff";
  if (/BFMO|楼宇|设施/.test(header)) return "bfmo_coordination";
  if (/格式|称呼|正文|落款/.test(header) || !header.trim()) return "format_reminder";
  return "general_reply";
}

export function categoryFromText(value: string): MessageAgentTemplateCategory {
  if (/推荐信|Recommendation Letter|recommender/i.test(value)) return "recommendation_letter";
  if (/BFMO|楼宇与设施|Buildings and Facilities/i.test(value)) return "bfmo_coordination";
  if (/团组织|团员|智慧团建|入团志愿书/.test(value)) return "youth_league";
  if (/送电|电费|electricity|kWh/i.test(value)) return "electricity_subsidy";
  if (/功能房|预约|签到|B203|D210|room reservation/i.test(value)) return "function_room";
  if (/保洁|物业人员|清洁|property staff/i.test(value)) return "property_staff";
  if (/活动报名|registered|registration|参与祥波/i.test(value)) return "event_registration";
  if (/称呼|正文|落款|格式/.test(value)) return "format_reminder";
  if (/维护|施工|停水|消杀|窗帘|清洗|Notice|Maintenance|Construction/i.test(value)) return "facility_notice";
  return "general_reply";
}

function titleFromFileAndSeed(fileName: string, seed: MessageAgentTemplateSeed): string {
  if (fileName.includes("邮件常用库")) return seed.title;
  return seed.title || fileName;
}

function normalizeCell(value: string | number | boolean): string {
  return String(value ?? "").trim();
}

export function normalizeText(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\t/g, " ")
    .replace(/[ \u00A0]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function firstLine(value: string): string {
  return value.split("\n").map((line) => line.trim()).find(Boolean)?.slice(0, 120) ?? "";
}

function portfolioShellText(text: string): boolean {
  const normalized = text.toLowerCase();
  const compact = normalized.replace(/\s+/g, "");
  return (
    compact.includes("pdfportfolio") ||
    (compact.includes("portfolio") && compact.includes("acrobat")) ||
    normalized.includes("for best experience, open this") ||
    (text.includes("PDF 包") && text.includes("Adobe Reader")) ||
    (text.includes("PDF 作品集") && text.includes("Adobe Reader"))
  );
}

function isPdfBuffer(buffer: Buffer): boolean {
  return buffer.subarray(0, 5).toString("latin1") === "%PDF-";
}

function safeAttachmentName(value: string): string {
  const trimmed = value.replace(/[\\/:*?"<>|]+/g, "_").trim();
  return trimmed || "embedded.pdf";
}

function extractXmlTexts(xml: string, tagName: string): string[] {
  const pattern = new RegExp(`<${escapeRegExp(tagName)}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapeRegExp(tagName)}>`, "g");
  const texts: string[] = [];
  for (const match of xml.matchAll(pattern)) {
    const value = decodeXml(match[1] ?? "").trim();
    if (value) texts.push(value);
  }
  return texts;
}

function decodeXml(value: string): string {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
