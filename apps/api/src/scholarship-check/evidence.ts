import { basename } from "node:path";
import type { ApplicantRecord, EvidenceRecord, ScholarshipCheckCategory } from "./types.js";

const categoryByFolderName: Array<[ScholarshipCheckCategory, string[]]> = [
  ["collegeContribution", ["书院贡献"]],
  ["studentOrganization", ["学生组织"]],
  ["socialPractice", ["社会服务与实践", "社会服务", "实践"]],
  ["award", ["奖项", "获奖"]]
];

export function normalizeName(value: string): string {
  return value
    .replace(/附件.*$/i, "")
    .replace(/[（(]证明材料[）)]/g, "")
    .replace(/\s+/g, "")
    .trim()
    .toLowerCase();
}

export function safePathSegments(relativePath: string): string[] {
  return relativePath
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment && segment !== "." && segment !== "..")
    .map((segment) => segment.replace(/[<>:"|?*\x00-\x1F]/g, "_"));
}

export function parseEvidencePath(originalRelativePath: string, localPath: string, contentType: string | null): EvidenceRecord {
  const segments = safePathSegments(originalRelativePath);
  const fileName = segments.at(-1) ?? basename(originalRelativePath);
  const applicantSegment = [...segments.slice(0, -1)].reverse().find((segment) => /附件/.test(segment)) ?? null;
  const category = inferCategory(segments);
  return {
    originalRelativePath,
    storedRelativePath: segments.join("/"),
    localPath,
    applicantName: applicantSegment ? applicantSegment.replace(/附件.*$/i, "").trim() || null : null,
    category,
    fileName,
    contentType
  };
}

export function matchEvidenceForApplicant(applicant: ApplicantRecord, evidence: EvidenceRecord[]): EvidenceRecord[] {
  const normalizedApplicant = normalizeName(applicant.name);
  return evidence.filter((item) => item.applicantName && normalizeName(item.applicantName) === normalizedApplicant);
}

export function evidenceByCategory(evidence: EvidenceRecord[]): Record<ScholarshipCheckCategory, EvidenceRecord[]> {
  return {
    collegeContribution: evidence.filter((item) => item.category === "collegeContribution"),
    studentOrganization: evidence.filter((item) => item.category === "studentOrganization"),
    socialPractice: evidence.filter((item) => item.category === "socialPractice"),
    award: evidence.filter((item) => item.category === "award")
  };
}

function inferCategory(segments: string[]): ScholarshipCheckCategory | null {
  for (const segment of segments) {
    for (const [category, names] of categoryByFolderName) {
      if (names.some((name) => segment.includes(name))) return category;
    }
  }
  return null;
}
