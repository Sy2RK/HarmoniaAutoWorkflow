import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { PDFParse } from "pdf-parse";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import { chunkMarkdown, normalizeWhitespace } from "./chunker.js";
import type { ParsedKnowledgeChunk, ParsedKnowledgeDocument } from "./types.js";

const supportedExtensions = new Set([".docx", ".pptx", ".xlsx", ".xls", ".pdf", ".md", ".txt", ".csv"]);
const legacyUnsupportedExtensions = new Set([".doc", ".ppt"]);

export function isArchiveFile(fileName: string): boolean {
  return extname(fileName).toLowerCase() === ".zip";
}

export function isLegacyUnsupportedOfficeFile(fileName: string): boolean {
  return legacyUnsupportedExtensions.has(extname(fileName).toLowerCase());
}

export function isSupportedKnowledgeFile(fileName: string): boolean {
  return supportedExtensions.has(extname(fileName).toLowerCase());
}

export async function parseKnowledgeDocument(input: {
  filePath: string;
  fileName: string;
  relativePath: string | null;
}): Promise<ParsedKnowledgeDocument> {
  const ext = extname(input.fileName).toLowerCase();
  switch (ext) {
    case ".md":
      return parseMarkdownLike(await readFile(input.filePath, "utf8"), input.relativePath, "Markdown");
    case ".txt":
      return parseMarkdownLike(await readFile(input.filePath, "utf8"), input.relativePath, "Text");
    case ".csv":
    case ".xlsx":
    case ".xls":
      return parseWorkbook(input.filePath, input.fileName, input.relativePath);
    case ".pdf":
      return parsePdf(input.filePath, input.relativePath);
    case ".docx":
      return parseDocx(input.filePath, input.relativePath);
    case ".pptx":
      return parsePptx(input.filePath, input.relativePath);
    default:
      throw new Error("COLLEGE_KNOWLEDGE_UNSUPPORTED_FILE_TYPE");
  }
}

export async function readZipEntries(zipPath: string): Promise<Array<{ name: string; buffer: Buffer }>> {
  const zip = await JSZip.loadAsync(await readFile(zipPath));
  const entries: Array<{ name: string; buffer: Buffer }> = [];
  const files = Object.values(zip.files).filter((file) => !file.dir);
  for (const file of files) {
    entries.push({ name: file.name, buffer: await file.async("nodebuffer") });
  }
  return entries;
}

function parseMarkdownLike(markdown: string, relativePath: string | null, kind: string): ParsedKnowledgeDocument {
  const cleaned = normalizeWhitespace(markdown);
  const chunks = chunkMarkdown(cleaned, {
    sourcePath: relativePath,
    locatorPrefix: kind,
    defaultTitle: relativePath
  });
  return {
    markdown: cleaned,
    chunks,
    metadata: { parser: kind.toLowerCase(), sourcePath: relativePath },
    warnings: chunks.length ? [] : ["文档没有可提取文本。"]
  };
}

async function parseWorkbook(filePath: string, fileName: string, relativePath: string | null): Promise<ParsedKnowledgeDocument> {
  const workbook = XLSX.read(await readFile(filePath), { type: "buffer", cellDates: false, raw: false });
  const chunks: ParsedKnowledgeChunk[] = [];
  const sections: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) continue;
    const rows = XLSX.utils.sheet_to_json<Array<string | number | boolean>>(worksheet, { header: 1, defval: "", raw: false });
    const header = normalizeHeader(rows[0] ?? []);
    const dataRows = rows.slice(1);
    if (dataRows.length === 0 && rows[0]?.some((cell) => String(cell).trim())) {
      dataRows.push(rows[0]!);
    }
    sections.push(`## ${sheetName}`);
    dataRows.forEach((row, rowIndex) => {
      const normalizedRow = row.map((cell) => normalizeCell(cell));
      if (!normalizedRow.some(Boolean)) return;
      const rowNumber = dataRows === rows ? rowIndex + 1 : rowIndex + 2;
      const fields = buildRowFields(header, normalizedRow);
      const title = pickTitle(fields) ?? `${sheetName} 第 ${rowNumber} 行`;
      const markdown = rowFieldsToMarkdown(title, fields);
      sections.push(markdown);
      chunks.push({
        title,
        locator: `${sheetName}!R${rowNumber}`,
        sourcePath: relativePath,
        text: fields.map((field) => `${field.label}: ${field.value}`).join("\n"),
        markdown,
        metadata: { parser: "workbook", sheetName, rowNumber, fileName }
      });
    });
  }
  return {
    markdown: sections.join("\n\n").trim(),
    chunks,
    metadata: { parser: "workbook", sheetCount: workbook.SheetNames.length, sourcePath: relativePath },
    warnings: chunks.length ? [] : ["工作簿没有可提取的有效行。"]
  };
}

async function parsePdf(filePath: string, relativePath: string | null): Promise<ParsedKnowledgeDocument> {
  const parser = new PDFParse({ data: await readFile(filePath) });
  try {
    const info = await parser.getInfo();
    const chunks: ParsedKnowledgeChunk[] = [];
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= info.total; pageNumber += 1) {
      const result = await parser.getText({ partial: [pageNumber] });
      const text = normalizeWhitespace(result.text ?? "");
      if (!text) continue;
      const markdown = `## Page ${pageNumber}\n\n${text}`;
      pages.push(markdown);
      chunks.push({
        title: `Page ${pageNumber}`,
        locator: `page ${pageNumber}`,
        sourcePath: relativePath,
        text,
        markdown,
        metadata: { parser: "pdf", pageNumber }
      });
    }
    return {
      markdown: pages.join("\n\n").trim(),
      chunks,
      metadata: { parser: "pdf", pageCount: info.total, sourcePath: relativePath },
      warnings: chunks.length ? [] : ["PDF 没有可提取文本；如为扫描件，需要先进行 OCR。"]
    };
  } finally {
    await parser.destroy();
  }
}

async function parseDocx(filePath: string, relativePath: string | null): Promise<ParsedKnowledgeDocument> {
  const zip = await JSZip.loadAsync(await readFile(filePath));
  const documentXml = await zip.file("word/document.xml")?.async("string");
  if (!documentXml) throw new Error("DOCX_DOCUMENT_XML_NOT_FOUND");
  const paragraphs = documentXml
    .split(/<\/w:p>/g)
    .map((paragraph) => extractXmlTexts(paragraph, "w:t").join(""))
    .map((paragraph) => normalizeWhitespace(paragraph))
    .filter(Boolean);
  const markdown = paragraphs.join("\n\n");
  const chunks = chunkMarkdown(markdown, { sourcePath: relativePath, locatorPrefix: "docx", defaultTitle: relativePath });
  return {
    markdown,
    chunks: chunks.map((chunk, index) => ({ ...chunk, locator: chunks.length > 1 ? `docx section ${index + 1}` : "docx" })),
    metadata: { parser: "docx", paragraphCount: paragraphs.length, sourcePath: relativePath },
    warnings: chunks.length ? [] : ["DOCX 没有可提取文本。"]
  };
}

async function parsePptx(filePath: string, relativePath: string | null): Promise<ParsedKnowledgeDocument> {
  const zip = await JSZip.loadAsync(await readFile(filePath));
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => slideNumber(a) - slideNumber(b));
  const chunks: ParsedKnowledgeChunk[] = [];
  const sections: string[] = [];
  for (const slideName of slideFiles) {
    const xml = await zip.file(slideName)?.async("string");
    if (!xml) continue;
    const number = slideNumber(slideName);
    const text = normalizeWhitespace(extractXmlTexts(xml, "a:t").join("\n"));
    if (!text) continue;
    const markdown = `## Slide ${number}\n\n${text}`;
    sections.push(markdown);
    chunks.push({
      title: `Slide ${number}`,
      locator: `slide ${number}`,
      sourcePath: relativePath,
      text,
      markdown,
      metadata: { parser: "pptx", slideNumber: number }
    });
  }
  return {
    markdown: sections.join("\n\n").trim(),
    chunks,
    metadata: { parser: "pptx", slideCount: slideFiles.length, sourcePath: relativePath },
    warnings: chunks.length ? [] : ["PPTX 没有可提取文本。"]
  };
}

function normalizeHeader(row: Array<string | number | boolean>): string[] {
  return row.map((cell, index) => normalizeCell(cell) || `Column ${index + 1}`);
}

function normalizeCell(value: string | number | boolean): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function buildRowFields(header: string[], row: string[]): Array<{ label: string; value: string }> {
  return row
    .map((value, index) => ({ label: header[index] ?? `Column ${index + 1}`, value }))
    .filter((field) => field.value.trim());
}

function pickTitle(fields: Array<{ label: string; value: string }>): string | null {
  const patterns = [/问题|题目|标题|名称|question|title|name/i, /关键词|主题|类别|category|topic/i];
  for (const pattern of patterns) {
    const field = fields.find((item) => pattern.test(item.label));
    if (field) return field.value.slice(0, 80);
  }
  return fields[0]?.value.slice(0, 80) ?? null;
}

function rowFieldsToMarkdown(title: string, fields: Array<{ label: string; value: string }>): string {
  return [`### ${title}`, ...fields.map((field) => `- ${field.label}: ${field.value}`)].join("\n");
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

function slideNumber(path: string): number {
  return Number(/slide(\d+)\.xml$/i.exec(path)?.[1] ?? 0);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
