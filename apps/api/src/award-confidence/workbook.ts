import XLSX from "xlsx";
import type { AwardConfidenceRow } from "@harmonia/shared";
import type { AwardConfidenceSourceRow, AwardDimension } from "./types.js";

export const confidenceColumns = ["第一奖项置信度", "第二奖项置信度"] as const;

type SheetParseResult = {
  rows: AwardConfidenceSourceRow[];
  targetSheets: Set<string>;
  hasTotalSheet: boolean;
};

type HeaderIndexes = {
  status: number;
  name: number;
  firstAward: number;
  secondAward: number;
  personalStatement: number;
  firstRecommender: number;
  secondRecommender: number;
  notes: number;
  dimensions: Record<AwardDimension, number>;
};

const requiredHeaders = ["姓名", "申请奖项第一奖项", "申请奖项第二奖项"] as const;
const totalSheetName = "\u603b\u8868";

export function parseAwardConfidenceWorkbook(workbookPath: string): AwardConfidenceSourceRow[] {
  const workbook = XLSX.readFile(workbookPath, { cellDates: false });
  const result = parseWorkbookRows(workbook);
  if (!result.hasTotalSheet) throw new Error("AWARD_CONFIDENCE_TOTAL_SHEET_REQUIRED");
  if (result.targetSheets.size === 0) throw new Error("AWARD_CONFIDENCE_MISSING_AWARD_COLUMNS");
  return result.rows;
}

export function writeAwardConfidenceWorkbook(workbookPath: string, rows: AwardConfidenceRow[], outputPath: string): void {
  const workbook = XLSX.readFile(workbookPath, { cellDates: false });
  const parsed = parseWorkbookRows(workbook);
  const confidenceByRow = new Map<string, AwardConfidenceRow>();
  for (const row of rows) {
    confidenceByRow.set(rowKey(row.sheetName, row.rowNumber), row);
  }

  const output = XLSX.utils.book_new();
  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) continue;
    const matrix = sheetToMatrix(worksheet);
    if (parsed.targetSheets.has(sheetName) && matrix.length > 0) {
      const header = [...(matrix[0] ?? []), ...confidenceColumns];
      const body = matrix.slice(1).map((sourceRow, index) => {
        const rowNumber = index + 2;
        const confidence = confidenceByRow.get(rowKey(sheetName, rowNumber));
        return [...sourceRow, confidence?.firstAwardConfidence ?? "", confidence?.secondAwardConfidence ?? ""];
      });
      XLSX.utils.book_append_sheet(output, XLSX.utils.aoa_to_sheet([header, ...body]), sheetName);
    } else {
      XLSX.utils.book_append_sheet(output, worksheet, sheetName);
    }
  }
  XLSX.writeFile(output, outputPath, { bookType: "xlsx" });
}

function parseWorkbookRows(workbook: XLSX.WorkBook): SheetParseResult {
  const rows: AwardConfidenceSourceRow[] = [];
  const targetSheets = new Set<string>();
  const worksheet = workbook.Sheets[totalSheetName];
  if (!worksheet) return { rows, targetSheets, hasTotalSheet: false };
  const matrix = sheetToMatrix(worksheet);
  const header = matrix[0] ?? [];
  const indexes = headerIndexes(header);
  if (!indexes) return { rows, targetSheets, hasTotalSheet: true };
  targetSheets.add(totalSheetName);
  for (const [index, sourceRow] of matrix.slice(1).entries()) {
    const rowNumber = index + 2;
    const name = cellText(sourceRow[indexes.name]);
    const firstAward = nullableCell(sourceRow[indexes.firstAward]);
    const secondAward = nullableCell(sourceRow[indexes.secondAward]);
    if (!name && !firstAward && !secondAward) continue;
    rows.push({
      sheetName: totalSheetName,
      rowNumber,
      name,
      initialStatus: cellText(sourceRow[indexes.status]),
      firstAward,
      secondAward,
      personalStatement: cellText(sourceRow[indexes.personalStatement]),
      firstRecommender: cellText(sourceRow[indexes.firstRecommender]),
      secondRecommender: cellText(sourceRow[indexes.secondRecommender]),
      dimensions: {
        collegeContribution: cellText(sourceRow[indexes.dimensions.collegeContribution]),
        servicePractice: cellText(sourceRow[indexes.dimensions.servicePractice]),
        dormService: cellText(sourceRow[indexes.dimensions.dormService]),
        academic: cellText(sourceRow[indexes.dimensions.academic]),
        studentOrg: cellText(sourceRow[indexes.dimensions.studentOrg]),
        awardsGeneral: cellText(sourceRow[indexes.dimensions.awardsGeneral]),
        sports: "",
        artsTalent: ""
      },
      notes: cellText(sourceRow[indexes.notes])
    });
  }
  return { rows, targetSheets, hasTotalSheet: true };
}

function headerIndexes(headers: Array<string | number | boolean>): HeaderIndexes | null {
  const normalized = headers.map((header) => normalizeHeader(header));
  if (!requiredHeaders.every((header) => normalized.includes(header))) return null;
  const indexOf = (header: string) => normalized.indexOf(header);
  return {
    status: optionalIndex(indexOf("初审情况")),
    name: indexOf("姓名"),
    firstAward: indexOf("申请奖项第一奖项"),
    secondAward: indexOf("申请奖项第二奖项"),
    personalStatement: optionalIndex(indexOf("个人陈述")),
    firstRecommender: optionalIndex(indexOf("第一位推荐人")),
    secondRecommender: optionalIndex(indexOf("第二位推荐人")),
    notes: optionalIndex(indexOf("核对备注说明")),
    dimensions: {
      collegeContribution: optionalIndex(indexOf("书院活动贡献")),
      servicePractice: optionalIndex(indexOf("社会服务实践和成就")),
      dormService: optionalIndex(indexOf("宿舍生活服务")),
      academic: optionalIndex(indexOf("学业表现")),
      studentOrg: optionalIndex(indexOf("学生组织")),
      awardsGeneral: optionalIndex(indexOf("奖项/其他")),
      sports: -1,
      artsTalent: -1
    }
  };
}

function sheetToMatrix(worksheet: XLSX.WorkSheet): Array<Array<string | number | boolean>> {
  return XLSX.utils.sheet_to_json<Array<string | number | boolean>>(worksheet, { header: 1, defval: "" });
}

function normalizeHeader(value: string | number | boolean): string {
  return String(value ?? "").replace(/\s+/g, "").trim();
}

function optionalIndex(index: number): number {
  return index >= 0 ? index : -1;
}

function cellText(value: string | number | boolean | undefined): string {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function nullableCell(value: string | number | boolean | undefined): string | null {
  const text = cellText(value);
  return text ? text : null;
}

function rowKey(sheetName: string, rowNumber: number): string {
  return `${sheetName}:${rowNumber}`;
}
