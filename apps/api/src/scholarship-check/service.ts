import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { ScholarshipCheckJob, ScholarshipCheckRow } from "@harmonia/shared";
import type { AiClient } from "../ai/client.js";
import { NoopAiClient } from "../ai/client.js";
import { evidenceByCategory, matchEvidenceForApplicant, parseEvidencePath, safePathSegments } from "./evidence.js";
import { buildRemark } from "./remarks.js";
import type { EvidenceRecord, ScholarshipCheckJobInternal, ScholarshipCheckJobSnapshot } from "./types.js";
import { categoryLabels, scholarshipCheckCategories } from "./types.js";
import { buildAiVerifiedRemark, type ScholarshipAiVerifierOptions } from "./verifier.js";
import { parseApplicants, writeProcessedWorkbook } from "./workbook.js";

type TempEvidenceFile = {
  tempPath: string;
  fileName: string;
  contentType: string | null;
};

type CreateJobInput = {
  workbookTempPath: string;
  workbookFileName: string;
  evidenceFiles: TempEvidenceFile[];
  evidencePaths: string[];
  mode: "ai" | "dry_run";
};

type RecentIndex = {
  ids: string[];
};

const indexFileName = "index.json";
const retentionLimit = 5;
const unfinishedRemark = scholarshipCheckCategories.map((category) => `${categoryLabels[category]}：未核对`).join("\n");

class PauseSignal extends Error {
  constructor() {
    super("SCHOLARSHIP_CHECK_PAUSED");
  }
}

class CancelSignal extends Error {
  constructor() {
    super("SCHOLARSHIP_CHECK_CANCELLED");
  }
}

export class ScholarshipCheckService {
  private readonly jobs = new Map<string, ScholarshipCheckJobSnapshot>();
  private readonly activeProcesses = new Set<string>();
  private readonly deletedJobs = new Set<string>();
  private readonly storageRoot: string;
  private readonly ai: AiClient;
  private readonly verifierOptions: ScholarshipAiVerifierOptions;
  private readonly initPromise: Promise<void>;

  constructor(storageRoot = "storage/scholarship-check", ai: AiClient = new NoopAiClient(), verifierOptions: ScholarshipAiVerifierOptions = {}) {
    this.storageRoot = isAbsolute(storageRoot) ? storageRoot : resolve(findWorkspaceRoot(), storageRoot);
    this.ai = ai;
    this.verifierOptions = verifierOptions;
    this.initPromise = this.initialize();
  }

  async createJob(input: CreateJobInput): Promise<ScholarshipCheckJob> {
    await this.ready();
    if (!input.workbookFileName.toLowerCase().endsWith(".xlsx")) {
      throw new Error("WORKBOOK_MUST_BE_XLSX");
    }
    if (input.evidenceFiles.length === 0) {
      throw new Error("EVIDENCE_FILES_REQUIRED");
    }
    if (input.evidencePaths.length !== input.evidenceFiles.length) {
      throw new Error("EVIDENCE_PATHS_MISMATCH");
    }

    const id = randomUUID();
    this.deletedJobs.delete(id);
    const createdAt = new Date().toISOString();
    const rootDir = join(this.storageRoot, id);
    const inputDir = join(rootDir, "input");
    const evidenceRoot = join(rootDir, "evidence");
    await mkdir(inputDir, { recursive: true });
    await mkdir(evidenceRoot, { recursive: true });

    const workbookPath = join(inputDir, "workbook.xlsx");
    try {
      await rename(input.workbookTempPath, workbookPath);
      const applicants = parseApplicants(workbookPath);
      const evidence = await this.moveEvidenceFiles(evidenceRoot, input.evidenceFiles, input.evidencePaths);
      await writeJson(join(rootDir, "evidence.json"), evidence);

      const job: ScholarshipCheckJobInternal = {
        id,
        status: "queued",
        createdAt,
        updatedAt: createdAt,
        totalApplicants: applicants.length,
        processedApplicants: 0,
        error: null,
        mode: input.mode,
        rootDir,
        workbookPath,
        resultPath: null
      };
      const rows: ScholarshipCheckRow[] = applicants.map((applicant) => ({
        rowNumber: applicant.rowNumber,
        name: applicant.name,
        studentId: applicant.studentId,
        status: "pending",
        remark: null,
        error: null,
        editedAt: null,
        editedBy: null
      }));
      const snapshot = { job, rows };
      await this.saveSnapshot(snapshot);
      await this.enforceRetention();
      void this.processJob(id);
      return publicJob(job);
    } catch (error) {
      this.jobs.delete(id);
      await this.removeFromIndex(id).catch(() => undefined);
      await rm(rootDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      throw error;
    }
  }

  async listJobs(limit = retentionLimit): Promise<{ items: ScholarshipCheckJob[]; total: number }> {
    await this.ready();
    const index = await this.loadIndex();
    const snapshots = (await Promise.all(index.ids.map((id) => this.loadSnapshot(id)))).filter((item): item is ScholarshipCheckJobSnapshot => Boolean(item));
    const items = snapshots.map((snapshot) => publicJob(snapshot.job)).slice(0, Math.max(1, Math.min(50, limit)));
    return { items, total: snapshots.length };
  }

  async getJob(id: string): Promise<{ job: ScholarshipCheckJob; rows: ScholarshipCheckRow[] } | null> {
    await this.ready();
    const snapshot = await this.loadSnapshot(id);
    return snapshot ? { job: publicJob(snapshot.job), rows: snapshot.rows } : null;
  }

  async updateRow(id: string, rowNumber: number, remark: string, editedBy: string | null): Promise<{ job: ScholarshipCheckJob; row: ScholarshipCheckRow } | null> {
    await this.ready();
    validateRemark(remark);
    const snapshot = await this.loadSnapshot(id);
    if (!snapshot) return null;
    const row = snapshot.rows.find((item) => item.rowNumber === rowNumber);
    if (!row) return null;
    row.remark = remark;
    row.status = "completed";
    row.error = null;
    row.editedAt = new Date().toISOString();
    row.editedBy = editedBy;
    snapshot.job.updatedAt = row.editedAt;
    if (canGenerateResult(snapshot.job.status)) {
      await this.generateResult(snapshot);
    }
    await this.saveSnapshot(snapshot);
    return { job: publicJob(snapshot.job), row };
  }

  async pauseJob(id: string): Promise<{ job: ScholarshipCheckJob; rows: ScholarshipCheckRow[] } | null> {
    await this.ready();
    const snapshot = await this.loadSnapshot(id);
    if (!snapshot) return null;
    if (snapshot.job.status === "queued" || snapshot.job.status === "processing") {
      snapshot.job.status = "paused";
      snapshot.job.error = null;
      snapshot.job.updatedAt = new Date().toISOString();
      await this.saveSnapshot(snapshot);
    }
    return { job: publicJob(snapshot.job), rows: snapshot.rows };
  }

  async resumeJob(id: string): Promise<{ job: ScholarshipCheckJob; rows: ScholarshipCheckRow[] } | null> {
    await this.ready();
    const snapshot = await this.loadSnapshot(id);
    if (!snapshot) return null;
    if (snapshot.job.status === "paused") {
      for (const row of snapshot.rows) {
        if (row.status === "processing") row.status = "pending";
      }
      snapshot.job.status = "queued";
      snapshot.job.error = null;
      snapshot.job.updatedAt = new Date().toISOString();
      await this.saveSnapshot(snapshot);
      setTimeout(() => void this.processJob(id), 0);
    }
    return { job: publicJob(snapshot.job), rows: snapshot.rows };
  }

  async cancelJob(id: string): Promise<{ job: ScholarshipCheckJob; rows: ScholarshipCheckRow[] } | null> {
    await this.ready();
    const snapshot = await this.loadSnapshot(id);
    if (!snapshot) return null;
    if (snapshot.job.status === "queued" || snapshot.job.status === "processing" || snapshot.job.status === "paused") {
      snapshot.job.status = "cancelled";
      snapshot.job.error = null;
      snapshot.job.updatedAt = new Date().toISOString();
      for (const row of snapshot.rows) {
        if (row.status === "pending" || row.status === "processing") {
          row.status = "cancelled";
          row.remark = row.remark ?? unfinishedRemark;
        }
      }
      await this.generateResult(snapshot);
      await this.saveSnapshot(snapshot);
    }
    return { job: publicJob(snapshot.job), rows: snapshot.rows };
  }

  async deleteJob(id: string): Promise<boolean> {
    await this.ready();
    const snapshot = await this.loadSnapshot(id);
    if (!snapshot) return false;
    this.deletedJobs.add(id);
    this.jobs.delete(id);
    await rm(snapshot.job.rootDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    await this.removeFromIndex(id);
    return true;
  }

  async resultPath(id: string): Promise<string | null> {
    await this.ready();
    const snapshot = await this.loadSnapshot(id);
    if (!snapshot || !canGenerateResult(snapshot.job.status)) return null;
    if (!snapshot.job.resultPath || !existsSync(snapshot.job.resultPath)) {
      await this.generateResult(snapshot);
      await this.saveSnapshot(snapshot);
    }
    return snapshot.job.resultPath && existsSync(snapshot.job.resultPath) ? snapshot.job.resultPath : null;
  }

  async isKnownJob(id: string): Promise<boolean> {
    await this.ready();
    return Boolean(await this.loadSnapshot(id));
  }

  private async processJob(id: string): Promise<void> {
    await this.ready();
    if (this.activeProcesses.has(id)) return;
    this.activeProcesses.add(id);
    const snapshot = await this.loadSnapshot(id);
    if (!snapshot) {
      this.activeProcesses.delete(id);
      return;
    }
    try {
      if (snapshot.job.status === "cancelled" || snapshot.job.status === "completed") return;
      if (snapshot.job.status === "paused") throw new PauseSignal();
      snapshot.job.status = "processing";
      snapshot.job.error = null;
      snapshot.job.updatedAt = new Date().toISOString();
      await this.saveSnapshot(snapshot);

      const applicants = parseApplicants(snapshot.job.workbookPath);
      const evidence = (await readJson<EvidenceRecord[]>(join(snapshot.job.rootDir, "evidence.json"))) ?? [];

      for (const applicant of applicants) {
        await this.ensureRunnable(id);
        const row = snapshot.rows.find((item) => item.rowNumber === applicant.rowNumber);
        if (!row || row.status === "completed" || row.status === "cancelled") continue;
        row.status = "processing";
        row.error = null;
        snapshot.job.updatedAt = new Date().toISOString();
        await this.saveSnapshot(snapshot);

        const applicantEvidence = evidenceByCategory(matchEvidenceForApplicant(applicant, evidence));
        const remark =
          snapshot.job.mode === "dry_run"
            ? buildRemark({
                collegeContribution: { declaredText: applicant.categories.collegeContribution, evidence: applicantEvidence.collegeContribution },
                studentOrganization: { declaredText: applicant.categories.studentOrganization, evidence: applicantEvidence.studentOrganization },
                socialPractice: { declaredText: applicant.categories.socialPractice, evidence: applicantEvidence.socialPractice },
                award: { declaredText: applicant.categories.award, evidence: applicantEvidence.award }
              })
            : await buildAiVerifiedRemark({
                ai: this.ai,
                applicant,
                evidenceByCategory: applicantEvidence,
                options: {
                  ...this.verifierOptions,
                  beforeModelRequest: () => this.ensureRunnable(id)
                }
              });
        await this.ensureRunnable(id);
        if (!row.editedAt) row.remark = remark;
        row.status = "completed";
        row.error = null;
        snapshot.job.updatedAt = new Date().toISOString();
        await this.saveSnapshot(snapshot);
      }

      await this.generateResult(snapshot);
      snapshot.job.status = "completed";
      snapshot.job.error = null;
      snapshot.job.updatedAt = new Date().toISOString();
      await this.saveSnapshot(snapshot);
    } catch (error) {
      if (error instanceof PauseSignal) {
        const current = (await this.loadSnapshot(id)) ?? snapshot;
        if (current.job.status !== "paused") return;
        current.job.status = "paused";
        current.job.updatedAt = new Date().toISOString();
        for (const row of current.rows) {
          if (row.status === "processing") row.status = "pending";
        }
        await this.saveSnapshot(current);
      } else if (error instanceof CancelSignal) {
        const current = (await this.loadSnapshot(id)) ?? snapshot;
        if (this.deletedJobs.has(id)) return;
        current.job.status = "cancelled";
        current.job.updatedAt = new Date().toISOString();
        for (const row of current.rows) {
          if (row.status === "pending" || row.status === "processing") {
            row.status = "cancelled";
            row.remark = row.remark ?? unfinishedRemark;
          }
        }
        await this.tryGenerateResult(current);
        await this.saveSnapshot(current);
      } else {
        if (this.deletedJobs.has(id)) return;
        snapshot.job.status = "failed";
        snapshot.job.error = error instanceof Error ? error.message : "UNKNOWN_ERROR";
        snapshot.job.updatedAt = new Date().toISOString();
        for (const row of snapshot.rows) {
          if (row.status === "processing" || row.status === "pending") row.status = "failed";
        }
        await this.tryGenerateResult(snapshot);
        await this.saveSnapshot(snapshot);
      }
    } finally {
      this.activeProcesses.delete(id);
    }
  }

  private async ensureRunnable(id: string): Promise<void> {
    const snapshot = await this.loadSnapshot(id);
    if (!snapshot || snapshot.job.status === "cancelled") throw new CancelSignal();
    if (snapshot.job.status === "paused") throw new PauseSignal();
  }

  private async generateResult(snapshot: ScholarshipCheckJobSnapshot): Promise<void> {
    const applicants = parseApplicants(snapshot.job.workbookPath);
    const remarks = new Map<number, string>();
    for (const row of snapshot.rows) {
      remarks.set(row.rowNumber, row.remark ?? unfinishedRemark);
    }
    const resultPath = join(snapshot.job.rootDir, "result.xlsx");
    writeProcessedWorkbook(applicants, remarks, resultPath);
    snapshot.job.resultPath = resultPath;
  }

  private async tryGenerateResult(snapshot: ScholarshipCheckJobSnapshot): Promise<void> {
    try {
      await this.generateResult(snapshot);
    } catch {
      snapshot.job.resultPath = null;
    }
  }

  private async moveEvidenceFiles(evidenceRoot: string, evidenceFiles: TempEvidenceFile[], evidencePaths: string[]): Promise<EvidenceRecord[]> {
    const records: EvidenceRecord[] = [];
    for (const [index, file] of evidenceFiles.entries()) {
      const rawRelativePath = evidencePaths[index] ?? file.fileName;
      const segments = safePathSegments(rawRelativePath);
      const storedRelativePath = segments.join("/") || `${index}-${file.fileName}`;
      const localPath = join(evidenceRoot, ...safePathSegments(storedRelativePath));
      await mkdir(dirname(localPath), { recursive: true });
      await rename(file.tempPath, localPath);
      records.push(parseEvidencePath(rawRelativePath, localPath, file.contentType));
    }
    return records;
  }

  private async initialize(): Promise<void> {
    await mkdir(this.storageRoot, { recursive: true });
    const index = await this.loadIndex();
    const discovered = await this.discoverSnapshotIds();
    const ids = uniqueIds([...index.ids, ...discovered]);
    for (const id of ids) {
      const snapshot = await this.loadSnapshot(id);
      if (!snapshot) continue;
      if (snapshot.job.status === "queued" || snapshot.job.status === "processing") {
        snapshot.job.status = "paused";
        snapshot.job.error = "任务因服务重启已暂停，可点击继续恢复。";
        snapshot.job.updatedAt = new Date().toISOString();
        for (const row of snapshot.rows) {
          if (row.status === "processing") row.status = "pending";
        }
        await writeJson(join(snapshot.job.rootDir, "job.json"), snapshot);
      }
    }
    const ordered = (await Promise.all(ids.map((id) => this.loadSnapshot(id))))
      .filter((item): item is ScholarshipCheckJobSnapshot => Boolean(item))
      .sort((a, b) => b.job.createdAt.localeCompare(a.job.createdAt))
      .map((snapshot) => snapshot.job.id);
    await this.writeIndex(ordered.slice(0, retentionLimit));
    await this.enforceRetention();
  }

  private async discoverSnapshotIds(): Promise<string[]> {
    try {
      const entries = await readdir(this.storageRoot, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isDirectory() && entry.name !== "tmp")
        .map((entry) => entry.name)
        .filter((id) => existsSync(join(this.storageRoot, id, "job.json")));
    } catch {
      return [];
    }
  }

  private async loadSnapshot(id: string): Promise<ScholarshipCheckJobSnapshot | null> {
    if (this.deletedJobs.has(id)) return null;
    const cached = this.jobs.get(id);
    if (cached) return cached;
    const snapshot = await readJson<ScholarshipCheckJobSnapshot>(join(this.storageRoot, id, "job.json"));
    if (this.deletedJobs.has(id)) return null;
    if (snapshot) this.jobs.set(id, snapshot);
    return snapshot;
  }

  private async saveSnapshot(snapshot: ScholarshipCheckJobSnapshot): Promise<void> {
    if (this.deletedJobs.has(snapshot.job.id)) return;
    snapshot.job.processedApplicants = snapshot.rows.filter((row) => row.status === "completed").length;
    if (this.deletedJobs.has(snapshot.job.id)) return;
    await mkdir(snapshot.job.rootDir, { recursive: true });
    if (await this.cleanupIfDeleted(snapshot)) return;
    await writeJson(join(snapshot.job.rootDir, "job.json"), snapshot);
    if (await this.cleanupIfDeleted(snapshot)) return;
    this.jobs.set(snapshot.job.id, snapshot);
    if (await this.cleanupIfDeleted(snapshot)) return;
    await this.touchIndex(snapshot.job.id);
    await this.cleanupIfDeleted(snapshot);
  }

  private async loadIndex(): Promise<RecentIndex> {
    return (await readJson<RecentIndex>(join(this.storageRoot, indexFileName))) ?? { ids: [] };
  }

  private async writeIndex(ids: string[]): Promise<void> {
    await writeJson(join(this.storageRoot, indexFileName), { ids: uniqueIds(ids) });
  }

  private async touchIndex(id: string): Promise<void> {
    if (this.deletedJobs.has(id)) return;
    const index = await this.loadIndex();
    if (this.deletedJobs.has(id)) return;
    await this.writeIndex([id, ...index.ids.filter((item) => item !== id)]);
    if (this.deletedJobs.has(id)) await this.removeFromIndex(id);
  }

  private async removeFromIndex(id: string): Promise<void> {
    const index = await this.loadIndex();
    await this.writeIndex(index.ids.filter((item) => item !== id));
  }

  private async cleanupIfDeleted(snapshot: ScholarshipCheckJobSnapshot): Promise<boolean> {
    if (!this.deletedJobs.has(snapshot.job.id)) return false;
    this.jobs.delete(snapshot.job.id);
    await rm(snapshot.job.rootDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    await this.removeFromIndex(snapshot.job.id);
    return true;
  }

  private async enforceRetention(): Promise<void> {
    const index = await this.loadIndex();
    const keep = index.ids.slice(0, retentionLimit);
    const remove = index.ids.slice(retentionLimit);
    const retainedActive: string[] = [];
    await Promise.all(
      remove.map(async (id) => {
        const snapshot = await this.loadSnapshot(id);
        if (snapshot && !canRemoveForRetention(snapshot.job.status)) {
          retainedActive.push(id);
          return;
        }
        this.jobs.delete(id);
        if (snapshot) await rm(snapshot.job.rootDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      })
    );
    await this.writeIndex([...keep, ...retainedActive]);
  }

  private async ready(): Promise<void> {
    await this.initPromise;
  }
}

export function scholarshipCheckStorageRoot(storageRoot = "storage/scholarship-check"): string {
  return isAbsolute(storageRoot) ? storageRoot : resolve(findWorkspaceRoot(), storageRoot);
}

function publicJob(job: ScholarshipCheckJobInternal): ScholarshipCheckJob {
  return {
    id: job.id,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    totalApplicants: job.totalApplicants,
    processedApplicants: job.processedApplicants,
    error: job.error
  };
}

function canGenerateResult(status: ScholarshipCheckJob["status"]): boolean {
  return status === "completed" || status === "cancelled" || status === "failed";
}

function canRemoveForRetention(status: ScholarshipCheckJob["status"]): boolean {
  return status === "completed" || status === "cancelled" || status === "failed";
}

function validateRemark(remark: string): void {
  const lines = remark.replace(/\r\n/g, "\n").split("\n");
  if (lines.length !== scholarshipCheckCategories.length) throw new Error("SCHOLARSHIP_CHECK_REMARK_FORMAT_INVALID");
  scholarshipCheckCategories.forEach((category, index) => {
    const label = categoryLabels[category];
    const line = lines[index] ?? "";
    if (!line.startsWith(`${label}：`) && !line.startsWith(`${label}:`)) {
      throw new Error("SCHOLARSHIP_CHECK_REMARK_FORMAT_INVALID");
    }
  });
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids.filter(Boolean))];
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2), "utf8");
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function findWorkspaceRoot(): string {
  let current = process.cwd();
  while (true) {
    if (existsSync(join(current, "pnpm-workspace.yaml"))) return current;
    const parent = dirname(current);
    if (parent === current) return process.cwd();
    current = parent;
  }
}
