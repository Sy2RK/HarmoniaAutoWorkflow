import type { EvidenceRecord, ScholarshipCheckCategory } from "./types.js";
import { categoryLabels, scholarshipCheckCategories } from "./types.js";

export const scholarshipRemarkTexts = {
  noProblem: "无问题",
  notFilled: "未填写",
  noEvidence: "无证明材料",
  partialMissing: "部分条目无证明材料",
  modelUnavailable: "模型未配置或未返回结果，需人工复核",
  modelFailed: "模型调用失败，需人工复核",
  unreadableEvidence: "证明材料无法渲染为图片，需人工复核"
} as const;

export type CategoryRemarkInput = {
  declaredText: string;
  evidence: EvidenceRecord[];
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

export function categoryRemark(input: CategoryRemarkInput): string {
  const text = input.declaredText.trim();
  if (!text || /^无$|^无[。.]?$|^暂无$/.test(text)) return scholarshipRemarkTexts.notFilled;

  const items = splitDeclaredItems(text);
  if (input.evidence.length === 0) return scholarshipRemarkTexts.noEvidence;

  const proofExpected = items.length ? items.filter((item) => !/无证明/.test(item)) : [text];
  if (proofExpected.length === 0) return input.evidence.length > 0 ? scholarshipRemarkTexts.noProblem : scholarshipRemarkTexts.noEvidence;
  if (input.evidence.length < proofExpected.length) return scholarshipRemarkTexts.partialMissing;
  return scholarshipRemarkTexts.noProblem;
}

export function buildRemark(categories: Record<ScholarshipCheckCategory, CategoryRemarkInput>): string {
  return scholarshipCheckCategories.map((category) => `${categoryLabels[category]}：${categoryRemark(categories[category])}`).join("\n");
}

export function emptyRemark(): string {
  return scholarshipCheckCategories.map((category) => `${categoryLabels[category]}：${scholarshipRemarkTexts.notFilled}`).join("\n");
}
