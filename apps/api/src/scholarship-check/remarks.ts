import type { EvidenceRecord, ScholarshipCheckCategory } from "./types.js";
import { categoryLabels, scholarshipCheckCategories } from "./types.js";

export const scholarshipRemarkTexts = {
  noProblem: "无问题",
  notFilled: "未填写",
  noEvidence: "无证明材料",
  partialMissing: "部分材料缺失",
  partialMismatch: "部分材料不匹配"
} as const;

export const scholarshipRemarkStatusValues = [
  scholarshipRemarkTexts.notFilled,
  scholarshipRemarkTexts.noEvidence,
  scholarshipRemarkTexts.partialMissing,
  scholarshipRemarkTexts.partialMismatch,
  scholarshipRemarkTexts.noProblem
] as const;

export type ScholarshipRemarkStatus = (typeof scholarshipRemarkStatusValues)[number];

export type CategoryRemarkInput = {
  declaredText: string;
  evidence: EvidenceRecord[];
};

export type CategoryCheckResult = {
  status: ScholarshipRemarkStatus;
  detail: string;
};

export type ScholarshipCheckResult = {
  remark: string;
  detail: string;
};

export function splitDeclaredItems(value: string): string[] {
  const text = value.trim();
  if (!text) return [];
  const normalized = text.replace(/\r\n/g, "\n");
  const parts = normalized
    .split(/\n\s*(?=\d+[、.．])/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length > 1) return parts;
  return normalized
    .split(/\n{2,}|；|;\s*(?=\d+[、.．])/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function categoryResult(input: CategoryRemarkInput): CategoryCheckResult {
  const text = input.declaredText.trim();
  if (!text || /^无$|^无[。.]?$|^暂无$/.test(text)) {
    return { status: scholarshipRemarkTexts.notFilled, detail: "申请表该栏为空或仅填写“无/暂无”。" };
  }

  const items = splitDeclaredItems(text);
  if (input.evidence.length === 0) {
    return { status: scholarshipRemarkTexts.noEvidence, detail: "该分类有申报内容，但未找到对应证明材料。" };
  }

  const proofExpected = items.length ? items.filter((item) => !/无证明/.test(item)) : [text];
  if (proofExpected.length === 0) {
    return { status: scholarshipRemarkTexts.noProblem, detail: "申报条目标注为无证明要求，未发现需补充证明的内容。" };
  }
  if (input.evidence.length < proofExpected.length) {
    return {
      status: scholarshipRemarkTexts.partialMissing,
      detail: `申报 ${proofExpected.length} 项，找到 ${input.evidence.length} 个证明文件，仍有部分申报项缺少证明。`
    };
  }
  return { status: scholarshipRemarkTexts.noProblem, detail: "申报内容有对应证明材料，未发现明显问题。" };
}

export function categoryRemark(input: CategoryRemarkInput): string {
  return categoryResult(input).status;
}

export function buildCheckResult(categories: Record<ScholarshipCheckCategory, CategoryRemarkInput>): ScholarshipCheckResult {
  const results = Object.fromEntries(
    scholarshipCheckCategories.map((category) => [category, categoryResult(categories[category])])
  ) as Record<ScholarshipCheckCategory, CategoryCheckResult>;
  return formatCheckResult(results);
}

export function buildRemark(categories: Record<ScholarshipCheckCategory, CategoryRemarkInput>): string {
  return buildCheckResult(categories).remark;
}

export function formatCheckResult(results: Record<ScholarshipCheckCategory, CategoryCheckResult>): ScholarshipCheckResult {
  return {
    remark: scholarshipCheckCategories.map((category) => `${categoryLabels[category]}：${results[category].status}`).join("\n"),
    detail: scholarshipCheckCategories.map((category) => `${categoryLabels[category]}：${results[category].detail}`).join("\n")
  };
}

export function emptyRemark(): string {
  return scholarshipCheckCategories.map((category) => `${categoryLabels[category]}：${scholarshipRemarkTexts.notFilled}`).join("\n");
}

export function emptyDetail(): string {
  return scholarshipCheckCategories.map((category) => `${categoryLabels[category]}：任务尚未完成该项核对，需人工复核。`).join("\n");
}
