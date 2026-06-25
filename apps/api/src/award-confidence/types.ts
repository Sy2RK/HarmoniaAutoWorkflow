import type { AwardConfidenceJob, AwardConfidenceRow } from "@harmonia/shared";

export type AwardConfidenceJobInternal = AwardConfidenceJob & {
  rootDir: string;
  workbookPath: string;
  resultPath: string | null;
};

export type AwardConfidenceJobSnapshot = {
  job: AwardConfidenceJobInternal;
  rows: AwardConfidenceRow[];
};

export type AwardDimension =
  | "collegeContribution"
  | "servicePractice"
  | "dormService"
  | "academic"
  | "studentOrg"
  | "awardsGeneral"
  | "sports"
  | "artsTalent";

export type AwardName = "院长嘉许奖" | "杰出领导力奖" | "优秀服务奖" | "卓越体育贡献奖" | "卓越才艺贡献奖";

export type AwardConfidenceSourceRow = {
  sheetName: string;
  rowNumber: number;
  name: string;
  initialStatus: string;
  firstAward: string | null;
  secondAward: string | null;
  personalStatement: string;
  firstRecommender: string;
  secondRecommender: string;
  dimensions: Record<AwardDimension, string>;
  notes: string;
};
