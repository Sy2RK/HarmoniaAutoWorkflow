import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { PDFParse } from "pdf-parse";
import type { AiClient, ScholarshipEvidenceImage, ScholarshipEvidenceVerification } from "../ai/client.js";
import {
  categoryResult,
  formatCheckResult,
  scholarshipRemarkTexts,
  splitDeclaredItems,
  type CategoryCheckResult,
  type ScholarshipCheckResult
} from "./remarks.js";
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
  return (await buildAiVerifiedCheckResult(input)).remark;
}

export async function buildAiVerifiedCheckResult(input: {
  ai: AiClient;
  applicant: ApplicantRecord;
  evidenceByCategory: Record<ScholarshipCheckCategory, EvidenceRecord[]>;
  options?: ScholarshipAiVerifierOptions;
}): Promise<ScholarshipCheckResult> {
  const results = {} as Record<ScholarshipCheckCategory, CategoryCheckResult>;
  for (const category of scholarshipCheckCategories) {
    results[category] = await verifyCategory({
      ai: input.ai,
      applicant: input.applicant,
      category,
      declaredText: input.applicant.categories[category],
      evidence: input.evidenceByCategory[category],
      options: input.options ?? {}
    });
  }
  return formatCheckResult(results);
}

async function verifyCategory(input: {
  ai: AiClient;
  applicant: ApplicantRecord;
  category: ScholarshipCheckCategory;
  declaredText: string;
  evidence: EvidenceRecord[];
  options?: ScholarshipAiVerifierOptions;
}): Promise<CategoryCheckResult> {
  const deterministic = categoryResult({ declaredText: input.declaredText, evidence: input.evidence });
  const requiredItems = proofRequiredItems(input.declaredText);
  if (
    deterministic.status === scholarshipRemarkTexts.notFilled ||
    deterministic.status === scholarshipRemarkTexts.noEvidence ||
    requiredItems.length === 0
  ) {
    return deterministic;
  }

  const collected = await evidenceToImages(input.evidence, input.options);
  if (collected.images.length === 0) {
    return { status: scholarshipRemarkTexts.partialMissing, detail: "证明材料无法渲染为图片，需人工复核。" };
  }

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
    return {
      status: scholarshipRemarkTexts.partialMissing,
      detail: failedCalls > 0 ? "模型调用失败，需人工复核。" : "模型未配置或未返回结果，需人工复核。"
    };
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
  deterministic: CategoryCheckResult,
  failedFiles: number
): CategoryCheckResult {
  const issues = unique(results.flatMap((result) => result.issues)).filter((issue) => !looksLikeMissingOnly(issue));
  const hardIssues = issues.filter(isHardMismatchIssue);
  const minorIssues = issues.filter((issue) => !hardIssues.includes(issue));
  const matched = unique(results.flatMap((result) => result.matchedItems));
  const missing = unique(results.flatMap((result) => result.missingItems));
  const anySupported = results.some((result) => result.supported && result.confidence >= 0.5);
  const allConfident = results.every((result) => result.confidence >= 0.35);

  if (hardIssues.length > 0) return { status: scholarshipRemarkTexts.partialMismatch, detail: shorten(hardIssues.join("；")) };

  if (matched.length >= requiredItems.length || (anySupported && missing.length === 0 && deterministic.status === scholarshipRemarkTexts.noProblem)) {
    return {
      status: scholarshipRemarkTexts.noProblem,
      detail: noProblemDetail(failedFiles, minorIssues, hardIssues)
    };
  }
  if (matched.length > 0 || anySupported) {
    return {
      status: scholarshipRemarkTexts.partialMissing,
      detail: missing.length
        ? shorten(`已匹配：${matched.join("；") || "部分申报项"}；缺少：${missing.join("；")}`)
        : "仅部分证明材料可确认申报内容，仍需人工复核。"
    };
  }
  if (missing.length > 0 || allConfident) {
    return {
      status: scholarshipRemarkTexts.noEvidence,
      detail: missing.length ? shorten(`未能在证明材料中确认：${missing.join("；")}`) : "未能在证明材料中确认申报内容。"
    };
  }
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

function isHardMismatchIssue(value: string): boolean {
  const normalized = value.toLowerCase();
  if (looksLikeMinorIssue(normalized)) return false;
  const hardPatterns = [
    /不同人|姓名.*(?:完全)?(?:不一致|不符)|申请人.*(?:不一致|不符)|不是同一人/,
    /完全不同|指向.*不同|不属于.*申报|与申报.*无关/,
    /年份.*(?:明显)?(?:不一致|冲突)|学年.*(?:明显)?(?:不一致|冲突)|未来时间|逻辑错误/,
    /奖项名称.*(?:不一致|不符|冲突)|项目名称.*(?:完全)?(?:不一致|不符|冲突)/,
    /奖项等级.*(?:不一致|不符|冲突)|名次.*(?:不一致|不符|冲突)|全国第四.*未.*体现/,
    /申报.*(?:奖项|项目).*证明.*(?:另一个|其他|不同)/
  ];
  return hardPatterns.some((pattern) => pattern.test(normalized));
}

function looksLikeMinorIssue(value: string): boolean {
  return /落款|签署|具体日期|无法.*核实.*日期|日期.*未.*显示|日期.*不完全|基本一致|基本吻合|名称.*不完全|同一实体|简称|英文|译名|拼写|错别字|一字之差|笔误|角色名称|职位.*近义|表述差异|证明效力|非正式|截图|照片|工作证.*模糊|文字.*模糊|未明确显示.*结束日期/.test(value);
}

function noProblemDetail(failedFiles: number, minorIssues: string[], hardIssues: string[]): string {
  const reviewNotes = [...minorIssues, ...hardIssues];
  if (reviewNotes.length > 0) return shorten(`核心信息匹配，轻微差异不影响通过：${reviewNotes.join("；")}`);
  return failedFiles > 0 ? "部分材料无法渲染，其余材料无明显问题，建议人工复核。" : "申报内容有对应证明材料，未发现明显问题。";
}

function isLifecycleSignal(error: unknown): boolean {
  return error instanceof Error && (error.message === "SCHOLARSHIP_CHECK_PAUSED" || error.message === "SCHOLARSHIP_CHECK_CANCELLED");
}
