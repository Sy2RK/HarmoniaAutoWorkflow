import type { ScholarshipCheckJob, ScholarshipCheckRow } from "@harmonia/shared";

export const scholarshipCheckCategories = ["collegeContribution", "studentOrganization", "socialPractice", "award"] as const;

export type ScholarshipCheckCategory = (typeof scholarshipCheckCategories)[number];

export const categoryLabels: Record<ScholarshipCheckCategory, string> = {
  collegeContribution: "书院贡献",
  studentOrganization: "学生组织",
  socialPractice: "社会服务与实践",
  award: "奖项"
};

export type ApplicantRecord = {
  rowNumber: number;
  values: Record<string, string | number>;
  name: string;
  studentId: string;
  categories: Record<ScholarshipCheckCategory, string>;
};

export type EvidenceRecord = {
  originalRelativePath: string;
  storedRelativePath: string;
  localPath: string;
  applicantName: string | null;
  category: ScholarshipCheckCategory | null;
  fileName: string;
  contentType: string | null;
};

export type ScholarshipCheckJobInternal = ScholarshipCheckJob & {
  mode: "ai" | "dry_run";
  rootDir: string;
  workbookPath: string;
  resultPath: string | null;
};

export type ScholarshipCheckJobSnapshot = {
  job: ScholarshipCheckJobInternal;
  rows: ScholarshipCheckRow[];
};
