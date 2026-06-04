import type { AwardInfo } from "../ai/client.js";

export type ScholarshipComparison = {
  matched: boolean;
  issues: string[];
  attachmentAwards: AwardInfo[];
};

function normalize(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, "");
}

function compatible(a: unknown, b: unknown): boolean {
  const left = normalize(a);
  const right = normalize(b);
  if (!left || !right) return true;
  return left.includes(right) || right.includes(left);
}

export function compareScholarshipMaterial(bodyData: Record<string, unknown>, attachmentAwards: AwardInfo[]): ScholarshipComparison {
  const issues: string[] = [];
  if (!attachmentAwards.length) {
    return { matched: false, issues: ["未能从附件图片识别奖项信息"], attachmentAwards };
  }

  const best = attachmentAwards.toSorted((a, b) => b.confidence - a.confidence)[0];
  if (!best || best.confidence < 0.45) issues.push("附件图片识别置信度较低，需要人工检查");
  if (best && !compatible(bodyData.awardName, best.awardName)) issues.push("正文奖项名称与附件识别结果不一致");
  if (best && !compatible(bodyData.awardLevel, best.level)) issues.push("正文获奖等级与附件识别结果不一致");
  if (best && !compatible(bodyData.name, best.winner)) issues.push("正文获奖人与附件识别结果不一致");
  if (best && !compatible(bodyData.issuer, best.issuer)) issues.push("正文颁发单位与附件识别结果不一致");

  return {
    matched: issues.length === 0,
    issues,
    attachmentAwards
  };
}
