import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { PDFParse } from "pdf-parse";
import type { AiClient, ScholarshipEvidenceImage, ScholarshipEvidenceVerification } from "../ai/client.js";
import { categoryRemark, scholarshipRemarkTexts, splitDeclaredItems } from "./remarks.js";
import type { ApplicantRecord, EvidenceRecord, ScholarshipCheckCategory } from "./types.js";
import { categoryLabels, scholarshipCheckCategories } from "./types.js";

export type ScholarshipAiVerifierOptions = {
  imagesPerRequest?: number;
  pdfImageWidth?: number;
  beforeModelRequest?: () => void | Promise<void>;
};

const defaultImagesPerRequest = 4;
const defaultPdfImageWidth = 1600;
const maxRemarkLength = 180;

export async function buildAiVerifiedRemark(input: {
  ai: AiClient;
  applicant: ApplicantRecord;
  evidenceByCategory: Record<ScholarshipCheckCategory, EvidenceRecord[]>;
  options?: ScholarshipAiVerifierOptions;
}): Promise<string> {
  const lines: string[] = [];
  for (const category of scholarshipCheckCategories) {
    const remark = await verifyCategory({
      ai: input.ai,
      applicant: input.applicant,
      category,
      declaredText: input.applicant.categories[category],
      evidence: input.evidenceByCategory[category],
      options: input.options ?? {}
    });
    lines.push(`${categoryLabels[category]}：${remark}`);
  }
  return lines.join("\n");
}

async function verifyCategory(input: {
  ai: AiClient;
  applicant: ApplicantRecord;
  category: ScholarshipCheckCategory;
  declaredText: string;
  evidence: EvidenceRecord[];
  options?: ScholarshipAiVerifierOptions;
}): Promise<string> {
  const deterministic = categoryRemark({ declaredText: input.declaredText, evidence: input.evidence });
  const requiredItems = proofRequiredItems(input.declaredText);
  if (
    deterministic === scholarshipRemarkTexts.notFilled ||
    deterministic === scholarshipRemarkTexts.noEvidence ||
    requiredItems.length === 0
  ) {
    return deterministic;
  }

  const collected = await evidenceToImages(input.evidence, input.options);
  if (collected.images.length === 0) return scholarshipRemarkTexts.unreadableEvidence;

  const results: ScholarshipEvidenceVerification[] = [];
  let failedCalls = 0;
  const batchSize = Math.max(1, input.options?.imagesPerRequest ?? defaultImagesPerRequest);
  const fileNames = unique(input.evidence.map((item) => item.fileName));
  for (const images of chunk(collected.images, batchSize)) {
    try {
      await input.options?.beforeModelRequest?.();
      const result = await input.ai.verifyScholarshipEvidence({
        applicantName: input.applicant.name,
        studentId: input.applicant.studentId,
        categoryLabel: categoryLabels[input.category],
        declaredText: input.declaredText,
        fileNames,
        images
      });
      if (result) results.push(result);
    } catch (error) {
      if (isLifecycleSignal(error)) throw error;
      failedCalls += 1;
    }
  }

  if (results.length === 0) {
    return failedCalls > 0 ? scholarshipRemarkTexts.modelFailed : scholarshipRemarkTexts.modelUnavailable;
  }
  return summarizeModelResults(results, requiredItems, deterministic, collected.failedFiles);
}

export async function evidenceToImages(
  evidence: EvidenceRecord[],
  options: ScholarshipAiVerifierOptions = {}
): Promise<{ images: ScholarshipEvidenceImage[]; failedFiles: number }> {
  const images: ScholarshipEvidenceImage[] = [];
  let failedFiles = 0;
  for (const record of evidence) {
    try {
      images.push(...(await evidenceRecordToImages(record, options)));
    } catch {
      failedFiles += 1;
    }
  }
  return { images, failedFiles };
}

async function evidenceRecordToImages(record: EvidenceRecord, options: ScholarshipAiVerifierOptions): Promise<ScholarshipEvidenceImage[]> {
  const mime = normalizedMime(record);
  if (mime === "application/pdf") {
    return renderPdfPages(record, options.pdfImageWidth ?? defaultPdfImageWidth);
  }
  if (!mime.startsWith("image/")) return [];
  const buffer = await readFile(record.localPath);
  return [
    {
      fileName: record.fileName,
      pageNumber: null,
      dataUrl: `data:${mime};base64,${buffer.toString("base64")}`
    }
  ];
}

async function renderPdfPages(record: EvidenceRecord, desiredWidth: number): Promise<ScholarshipEvidenceImage[]> {
  const parser = new PDFParse({ data: await readFile(record.localPath) });
  try {
    const info = await parser.getInfo();
    const pages: ScholarshipEvidenceImage[] = [];
    for (let pageNumber = 1; pageNumber <= info.total; pageNumber += 1) {
      const screenshot = await parser.getScreenshot({
        partial: [pageNumber],
        desiredWidth,
        imageDataUrl: true,
        imageBuffer: false
      });
      const page = screenshot.pages[0];
      if (page?.dataUrl) {
        pages.push({
          fileName: record.fileName,
          pageNumber,
          dataUrl: page.dataUrl
        });
      }
    }
    return pages;
  } finally {
    await parser.destroy();
  }
}

function summarizeModelResults(
  results: ScholarshipEvidenceVerification[],
  requiredItems: string[],
  deterministic: string,
  failedFiles: number
): string {
  const issues = unique(results.flatMap((result) => result.issues)).filter((issue) => !looksLikeMissingOnly(issue));
  if (issues.length > 0) return shorten(issues.join("；"));

  const matched = unique(results.flatMap((result) => result.matchedItems));
  const missing = unique(results.flatMap((result) => result.missingItems));
  const anySupported = results.some((result) => result.supported && result.confidence >= 0.5);
  const allConfident = results.every((result) => result.confidence >= 0.35);

  if (matched.length >= requiredItems.length || (anySupported && missing.length === 0 && deterministic === scholarshipRemarkTexts.noProblem)) {
    return failedFiles > 0 ? "部分材料无法渲染，其余材料无明显问题" : scholarshipRemarkTexts.noProblem;
  }
  if (matched.length > 0 || anySupported) return scholarshipRemarkTexts.partialMissing;
  if (missing.length > 0 || allConfident) return scholarshipRemarkTexts.noEvidence;
  return deterministic;
}

function proofRequiredItems(value: string): string[] {
  const text = value.trim();
  if (!text || /^无$|^无[。.]?$|^暂无$/.test(text)) return [];
  const items = splitDeclaredItems(text);
  return (items.length ? items : [text]).filter((item) => !/无证明/.test(item));
}

function normalizedMime(record: EvidenceRecord): string {
  const explicit = record.contentType?.split(";")[0]?.trim().toLowerCase();
  if (explicit && explicit !== "application/octet-stream") return explicit;
  const ext = extname(record.fileName).toLowerCase();
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return explicit || "application/octet-stream";
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) batches.push(items.slice(index, index + size));
  return batches;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function shorten(value: string): string {
  return value.length > maxRemarkLength ? `${value.slice(0, maxRemarkLength - 1)}…` : value;
}

function looksLikeMissingOnly(value: string): boolean {
  return /无证明|未见|缺少|无法确认/.test(value) && !/不一致|矛盾|错误|不符/.test(value);
}

function isLifecycleSignal(error: unknown): boolean {
  return error instanceof Error && (error.message === "SCHOLARSHIP_CHECK_PAUSED" || error.message === "SCHOLARSHIP_CHECK_CANCELLED");
}
