import XLSX from "xlsx";
import type { ApplicantRecord } from "./types.js";

export const outputColumns = [
  "序号",
  "姓名",
  "性别",
  "学号",
  "学院",
  "专业",
  "学业表现",
  "个人陈述",
  "书院贡献",
  "学生组织",
  "社会服务与实践",
  "奖项",
  "学院违纪情况",
  "书院违纪情况",
  "核对情况备注"
] as const;

const sourceColumns = [
  "序号",
  "姓名",
  "性别",
  "学号",
  "入学年度",
  "学院",
  "宿舍号",
  "专业",
  "电话号码",
  "个人陈述",
  "书院贡献",
  "社会服务与实践",
  "学业表现",
  "学生组织",
  "奖项"
] as const;

const defaultDiscipline = "无违纪记录";

export function parseApplicants(workbookPath: string): ApplicantRecord[] {
  const workbook = XLSX.readFile(workbookPath, { cellDates: false });
  const sheetName = workbook.SheetNames.includes("Export") ? "Export" : workbook.SheetNames[0];
  if (!sheetName) throw new Error("WORKBOOK_HAS_NO_SHEETS");
  const rows = XLSX.utils.sheet_to_json<Array<string | number>>(workbook.Sheets[sheetName]!, { header: 1, defval: "" });
  const headers = rows[0]?.map((value) => String(value).trim()) ?? [];
  for (const column of ["姓名", "学号"]) {
    if (!headers.includes(column)) throw new Error(`WORKBOOK_MISSING_COLUMN:${column}`);
  }

  return rows
    .slice(1)
    .map((row, index) => rowToApplicant(headers, row, index + 2))
    .filter((row) => row.name || row.studentId);
}

export function writeProcessedWorkbook(applicants: ApplicantRecord[], remarks: Map<number, string>, outputPath: string): void {
  const rows = applicants.map((applicant) => {
    const record: Record<string, string | number> = {};
    for (const column of outputColumns) {
      if (column === "学院违纪情况" || column === "书院违纪情况") {
        record[column] = defaultDiscipline;
      } else if (column === "核对情况备注") {
        record[column] = remarks.get(applicant.rowNumber) ?? "";
      } else {
        record[column] = applicant.values[column] ?? "";
      }
    }
    return record;
  });
  const worksheet = XLSX.utils.json_to_sheet(rows, { header: [...outputColumns] });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");
  XLSX.writeFile(workbook, outputPath, { bookType: "xlsx" });
}

function rowToApplicant(headers: string[], row: Array<string | number>, rowNumber: number): ApplicantRecord {
  const values: Record<string, string | number> = {};
  for (const column of sourceColumns) {
    const index = headers.indexOf(column);
    values[column] = index >= 0 ? normalizeCell(row[index]) : "";
  }
  return {
    rowNumber,
    values,
    name: String(values["姓名"] ?? "").trim(),
    studentId: String(values["学号"] ?? "").trim(),
    categories: {
      collegeContribution: String(values["书院贡献"] ?? ""),
      studentOrganization: String(values["学生组织"] ?? ""),
      socialPractice: String(values["社会服务与实践"] ?? ""),
      award: String(values["奖项"] ?? "")
    }
  };
}

function normalizeCell(value: string | number | undefined): string | number {
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value.trim() : value;
}
