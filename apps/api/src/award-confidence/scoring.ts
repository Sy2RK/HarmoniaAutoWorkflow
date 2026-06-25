import type { AwardConfidenceTextEvaluation, AwardConfidenceTextEvaluationInput, AwardConfidenceTextField } from "../ai/client.js";
import type { AwardConfidenceSourceRow, AwardDimension, AwardName } from "./types.js";

type AwardProfile = {
  fieldWeights: Partial<Record<AwardConfidenceTextField, number>>;
};

const awardNames = ["院长嘉许奖", "杰出领导力奖", "优秀服务奖", "卓越体育贡献奖", "卓越才艺贡献奖"] as const;

export const awardProfiles: Record<AwardName, AwardProfile> = {
  院长嘉许奖: {
    fieldWeights: {
      personalStatement: 0.15,
      collegeContribution: 0.3,
      servicePractice: 0.2,
      dormService: 0.15,
      studentOrg: 0.2
    }
  },
  杰出领导力奖: {
    fieldWeights: {
      personalStatement: 0.1,
      collegeContribution: 0.2,
      servicePractice: 0.1,
      dormService: 0.1,
      studentOrg: 0.5
    }
  },
  优秀服务奖: {
    fieldWeights: {
      personalStatement: 0.1,
      collegeContribution: 0.2,
      servicePractice: 0.4,
      dormService: 0.25,
      studentOrg: 0.05
    }
  },
  卓越体育贡献奖: {
    fieldWeights: {
      personalStatement: 0.1,
      collegeContribution: 0.2,
      servicePractice: 0.05,
      dormService: 0.05,
      studentOrg: 0.1,
      sports: 0.5
    }
  },
  卓越才艺贡献奖: {
    fieldWeights: {
      personalStatement: 0.1,
      collegeContribution: 0.2,
      servicePractice: 0.05,
      dormService: 0.05,
      studentOrg: 0.1,
      artsTalent: 0.5
    }
  }
};

const sourceDimensionFields: Array<[AwardDimension, AwardConfidenceTextField]> = [
  ["collegeContribution", "collegeContribution"],
  ["servicePractice", "servicePractice"],
  ["dormService", "dormService"],
  ["academic", "academic"],
  ["studentOrg", "studentOrg"],
  ["awardsGeneral", "awardsGeneral"]
];

export function scoreAwardConfidence(awardValue: string | null, evaluation: AwardConfidenceTextEvaluation | null): number | null {
  const awardName = normalizeAwardName(awardValue);
  if (!awardName) return null;
  if (!evaluation) throw new Error("AWARD_CONFIDENCE_AI_UNAVAILABLE");
  const profile = awardProfiles[awardName];
  let weightedScore = 0;
  let weightTotal = 0;
  for (const [field, weight] of Object.entries(profile.fieldWeights) as Array<[AwardConfidenceTextField, number]>) {
    weightedScore += weight * clamp01(evaluation.fieldScores[field] ?? 0);
    weightTotal += weight;
  }
  const matchScore = weightTotal > 0 ? weightedScore / weightTotal : 0;
  return roundOne(100 * clamp01(matchScore - clampRiskPenalty(evaluation.riskPenalty)));
}

export function buildAwardConfidenceEvaluationInput(row: AwardConfidenceSourceRow, awardValue: string | null): AwardConfidenceTextEvaluationInput | null {
  const awardName = normalizeAwardName(awardValue);
  if (!awardName) return null;
  return {
    applicantName: row.name,
    awardName,
    sheetName: row.sheetName,
    rowNumber: row.rowNumber,
    fields: awardConfidenceFields(row),
    notes: row.notes
  };
}

export function normalizeAwardName(value: string | null | undefined): AwardName | null {
  const normalized = normalizeText(value ?? "");
  if (!normalized) return null;
  return awardNames.find((awardName) => normalized.includes(normalizeText(awardName))) ?? null;
}

function awardConfidenceFields(row: AwardConfidenceSourceRow): Record<AwardConfidenceTextField, string> {
  const fields = {
    personalStatement: row.personalStatement,
    collegeContribution: "",
    servicePractice: "",
    dormService: "",
    academic: "",
    studentOrg: "",
    awardsGeneral: "",
    sports: "",
    artsTalent: ""
  } satisfies Record<AwardConfidenceTextField, string>;
  for (const [dimension, field] of sourceDimensionFields) {
    fields[field] = row.dimensions[dimension];
  }
  const specialityText = [row.personalStatement, row.dimensions.awardsGeneral, row.dimensions.studentOrg, row.dimensions.collegeContribution].join("\n");
  fields.sports = specialityText;
  fields.artsTalent = specialityText;
  return fields;
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "");
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function clampRiskPenalty(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(0.35, value));
}

function roundOne(value: number): number {
  return Math.round(value * 10) / 10;
}
