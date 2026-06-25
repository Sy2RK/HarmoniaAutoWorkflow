import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type { AwardConfidenceJob, AwardConfidenceRow } from "@harmonia/shared";
import type { AiClient } from "../ai/client.js";
import { NoopAiClient } from "../ai/client.js";
import { buildAwardConfidenceEvaluationInput, scoreAwardConfidence } from "./scoring.js";
import type { AwardConfidenceJobInternal, AwardConfidenceJobSnapshot } from "./types.js";
import { parseAwardConfidenceWorkbook, writeAwardConfidenceWorkbook } from "./workbook.js";

type CreateJobInput = {
  workbookTempPath: string;
  workbookFileName: string;
};

type RecentIndex = {
  ids: string[];
};

const indexFileName = "index.json";
const retentionLimit = 5;
const restartPauseMessage = "\u4efb\u52a1\u56e0\u670d\u52a1\u91cd\u542f\u5df2\u6682\u505c\uff0c\u53ef\u70b9\u51fb\u7ee7\u7eed\u6062\u590d\u3002";

class PauseSignal extends Error {
  constructor() {
    super("AWARD_CONFIDENCE_PAUSED");
  }
}

class CancelSignal extends Error {
  constructor() {
    super("AWARD_CONFIDENCE_CANCELLED");
  }
}

export class AwardConfidenceService {
  private readonly jobs = new Map<string, AwardConfidenceJobSnapshot>();
  private readonly activeProcesses = new Set<string>();
  private readonly resumeRequests = new Set<string>();
  private readonly deletedJobs = new Set<string>();
  private readonly storageRoot: string;
  private readonly ai: AiClient;
  private readonly initPromise: Promise<void>;

  constructor(storageRoot = "storage/award-confidence", ai: AiClient = new NoopAiClient()) {
    this.storageRoot = isAbsolute(storageRoot) ? storageRoot : resolve(findWorkspaceRoot(), storageRoot);
    this.ai = ai;
    this.initPromise = this.initialize();
  }

  async createJob(input: CreateJobInput): Promise<AwardConfidenceJob> {
    await this.ready();
    if (!input.workbookFileName.toLowerCase().endsWith(".xlsx")) {
      throw new Error("AWARD_CONFIDENCE_WORKBOOK_MUST_BE_XLSX");
    }
    const id = randomUUID();
    this.deletedJobs.delete(id);
    const createdAt = new Date().toISOString();
    const rootDir = join(this.storageRoot, id);
    const inputDir = join(rootDir, "input");
    await mkdir(inputDir, { recursive: true });
    const workbookPath = join(inputDir, "workbook.xlsx");
    try {
      await rename(input.workbookTempPath, workbookPath);
      const sourceRows = parseAwardConfidenceWorkbook(workbookPath);
      const job: AwardConfidenceJobInternal = {
        id,
        status: "queued",
        createdAt,
        updatedAt: createdAt,
        totalRows: sourceRows.length,
        processedRows: 0,
        error: null,
        rootDir,
        workbookPath,
        resultPath: null
      };
      const rows: AwardConfidenceRow[] = sourceRows.map((sourceRow) => ({
        sheetName: sourceRow.sheetName,
        rowNumber: sourceRow.rowNumber,
        name: sourceRow.name,
        firstAward: sourceRow.firstAward,
        secondAward: sourceRow.secondAward,
        firstAwardConfidence: null,
        secondAwardConfidence: null,
        status: "pending",
        error: null
      }));
      await this.saveSnapshot({ job, rows });
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

  async listJobs(limit = retentionLimit): Promise<{ items: AwardConfidenceJob[]; total: number }> {
    await this.ready();
    const index = await this.loadIndex();
    const snapshots = (await Promise.all(index.ids.map((id) => this.loadSnapshot(id)))).filter((item): item is AwardConfidenceJobSnapshot => Boolean(item));
    const items = snapshots.map((snapshot) => publicJob(snapshot.job)).slice(0, Math.max(1, Math.min(50, limit)));
    return { items, total: snapshots.length };
  }

  async getJob(id: string): Promise<{ job: AwardConfidenceJob; rows: AwardConfidenceRow[] } | null> {
    await this.ready();
    const snapshot = await this.loadSnapshot(id);
    return snapshot ? { job: publicJob(snapshot.job), rows: snapshot.rows } : null;
  }

  async resultPath(id: string): Promise<string | null> {
    await this.ready();
    const snapshot = await this.loadSnapshot(id);
    if (!snapshot || (snapshot.job.status !== "completed" && snapshot.job.status !== "cancelled")) return null;
    return snapshot.job.resultPath && existsSync(snapshot.job.resultPath) ? snapshot.job.resultPath : null;
  }

  async isKnownJob(id: string): Promise<boolean> {
    await this.ready();
    return Boolean(await this.loadSnapshot(id));
  }

  async pauseJob(id: string): Promise<{ job: AwardConfidenceJob; rows: AwardConfidenceRow[] } | null> {
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

  async resumeJob(id: string): Promise<{ job: AwardConfidenceJob; rows: AwardConfidenceRow[] } | null> {
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
      if (this.activeProcesses.has(id)) {
        this.resumeRequests.add(id);
      } else {
        setTimeout(() => void this.processJob(id), 0);
      }
    }
    return { job: publicJob(snapshot.job), rows: snapshot.rows };
  }

  async cancelJob(id: string): Promise<{ job: AwardConfidenceJob; rows: AwardConfidenceRow[] } | null> {
    await this.ready();
    const snapshot = await this.loadSnapshot(id);
    if (!snapshot) return null;
    this.resumeRequests.delete(id);
    if (snapshot.job.status === "queued" || snapshot.job.status === "processing" || snapshot.job.status === "paused") {
      snapshot.job.status = "cancelled";
      snapshot.job.error = null;
      snapshot.job.updatedAt = new Date().toISOString();
      for (const row of snapshot.rows) {
        if (row.status === "pending" || row.status === "processing") {
          row.status = "cancelled";
          row.error = null;
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
    this.resumeRequests.delete(id);
    this.deletedJobs.add(id);
    this.jobs.delete(id);
    await rm(snapshot.job.rootDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    await this.removeFromIndex(id);
    return true;
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
      const sourceRows = parseAwardConfidenceWorkbook(snapshot.job.workbookPath);
      for (const sourceRow of sourceRows) {
        await this.checkControl(id);
        const row = snapshot.rows.find((item) => item.sheetName === sourceRow.sheetName && item.rowNumber === sourceRow.rowNumber);
        if (!row || row.status === "completed" || row.status === "cancelled") continue;
        row.status = "processing";
        row.error = null;
        snapshot.job.updatedAt = new Date().toISOString();
        await this.saveSnapshot(snapshot);
        await this.checkControl(id);
        row.firstAwardConfidence = await this.scoreAward(sourceRow, sourceRow.firstAward);
        await this.checkControl(id);
        row.secondAwardConfidence = await this.scoreAward(sourceRow, sourceRow.secondAward);
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
        current.job.error = null;
        current.job.updatedAt = new Date().toISOString();
        for (const row of current.rows) {
          if (row.status === "pending" || row.status === "processing") {
            row.status = "cancelled";
            row.error = null;
          }
        }
        await this.generateResult(current);
        await this.saveSnapshot(current);
      } else {
        if (this.deletedJobs.has(id)) return;
        snapshot.job.status = "failed";
        snapshot.job.error = error instanceof Error ? error.message : "AWARD_CONFIDENCE_JOB_FAILED";
        snapshot.job.updatedAt = new Date().toISOString();
        for (const row of snapshot.rows) {
          if (row.status === "pending" || row.status === "processing") {
            row.status = "failed";
            row.error = snapshot.job.error;
          }
        }
        await this.saveSnapshot(snapshot);
      }
    } finally {
      this.activeProcesses.delete(id);
      if (this.resumeRequests.delete(id)) {
        const current = await this.loadSnapshot(id);
        if (current?.job.status === "queued") setTimeout(() => void this.processJob(id), 0);
      }
    }
  }

  private async checkControl(id: string): Promise<void> {
    const snapshot = await this.loadSnapshot(id);
    if (!snapshot || snapshot.job.status === "cancelled") throw new CancelSignal();
    if (snapshot.job.status === "paused") throw new PauseSignal();
  }

  private async generateResult(snapshot: AwardConfidenceJobSnapshot): Promise<void> {
    if (this.deletedJobs.has(snapshot.job.id)) return;
    const resultPath = join(snapshot.job.rootDir, "result.xlsx");
    writeAwardConfidenceWorkbook(snapshot.job.workbookPath, snapshot.rows, resultPath);
    snapshot.job.resultPath = resultPath;
  }

  private async scoreAward(sourceRow: ReturnType<typeof parseAwardConfidenceWorkbook>[number], awardValue: string | null): Promise<number | null> {
    const input = buildAwardConfidenceEvaluationInput(sourceRow, awardValue);
    if (!input) return null;
    const evaluation = await this.ai.evaluateAwardConfidence(input);
    return scoreAwardConfidence(awardValue, evaluation);
  }

  private async loadSnapshot(id: string): Promise<AwardConfidenceJobSnapshot | null> {
    if (this.deletedJobs.has(id)) return null;
    const cached = this.jobs.get(id);
    if (cached) return cached;
    const snapshot = await readJson<AwardConfidenceJobSnapshot>(join(this.storageRoot, id, "job.json"));
    if (this.deletedJobs.has(id)) return null;
    if (snapshot) this.jobs.set(id, snapshot);
    return snapshot;
  }

  private async saveSnapshot(snapshot: AwardConfidenceJobSnapshot): Promise<void> {
    if (this.deletedJobs.has(snapshot.job.id)) return;
    snapshot.job.processedRows = snapshot.rows.filter((row) => row.status === "completed").length;
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

  private async initialize(): Promise<void> {
    await mkdir(this.storageRoot, { recursive: true });
    const index = await this.loadIndex();
    const discovered = await this.discoverSnapshotIds();
    const ids = uniqueIds([...index.ids, ...discovered]);
    const resumeIds: string[] = [];
    for (const id of ids) {
      const snapshot = await this.loadSnapshot(id);
      if (!snapshot) continue;
      if (
        snapshot.job.status === "queued" ||
        snapshot.job.status === "processing" ||
        (snapshot.job.status === "paused" && snapshot.job.error === restartPauseMessage)
      ) {
        snapshot.job.status = "queued";
        snapshot.job.error = null;
        snapshot.job.updatedAt = new Date().toISOString();
        for (const row of snapshot.rows) {
          if (row.status === "processing") row.status = "pending";
        }
        await writeJson(join(snapshot.job.rootDir, "job.json"), snapshot);
        resumeIds.push(snapshot.job.id);
      }
    }
    const ordered = (await Promise.all(ids.map((id) => this.loadSnapshot(id))))
      .filter((item): item is AwardConfidenceJobSnapshot => Boolean(item))
      .sort((a, b) => b.job.createdAt.localeCompare(a.job.createdAt))
      .map((snapshot) => snapshot.job.id);
    await this.writeIndex(ordered.slice(0, retentionLimit));
    await this.enforceRetention();
    for (const id of resumeIds) {
      setTimeout(() => void this.processJob(id), 0);
    }
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

  private async cleanupIfDeleted(snapshot: AwardConfidenceJobSnapshot): Promise<boolean> {
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

export function awardConfidenceStorageRoot(storageRoot = "storage/award-confidence"): string {
  return isAbsolute(storageRoot) ? storageRoot : resolve(findWorkspaceRoot(), storageRoot);
}

export async function cleanupAwardConfidenceTempFiles(paths: string[]): Promise<void> {
  await Promise.all(paths.map((path) => rm(path, { force: true }).catch(() => undefined)));
}

function publicJob(job: AwardConfidenceJobInternal): AwardConfidenceJob {
  return {
    id: job.id,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    totalRows: job.totalRows,
    processedRows: job.processedRows,
    error: job.error
  };
}

function canRemoveForRetention(status: AwardConfidenceJob["status"]): boolean {
  return status === "completed" || status === "cancelled" || status === "failed";
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids.filter(Boolean))];
}

async function writeJson(path: string, value: unknown): Promise<void> {
  const body = JSON.stringify(value, null, 2);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const directory = dirname(path);
    const tempPath = join(directory, `.${basename(path)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`);
    try {
      await mkdir(directory, { recursive: true });
      await writeFile(tempPath, body, "utf8");
      await replaceFile(tempPath, path);
      return;
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => undefined);
      if (!isRetryableFileError(error) || attempt === 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    const body = await readFile(path, "utf8");
    if (!body.trim()) throw new Error("EMPTY_JSON_SNAPSHOT");
    return JSON.parse(body) as T;
  } catch {
    try {
      const backupBody = await readFile(`${path}.bak`, "utf8");
      return backupBody.trim() ? (JSON.parse(backupBody) as T) : null;
    } catch {
      return null;
    }
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

async function replaceFile(tempPath: string, path: string): Promise<void> {
  const backupPath = `${path}.bak`;
  let hasBackup = false;
  await rm(backupPath, { force: true }).catch(() => undefined);
  try {
    await rename(path, backupPath);
    hasBackup = true;
  } catch (error) {
    if (!isEnoent(error)) throw error;
  }
  try {
    await rename(tempPath, path);
    if (hasBackup) await rm(backupPath, { force: true }).catch(() => undefined);
  } catch (error) {
    if (hasBackup && !existsSync(path) && existsSync(backupPath)) {
      await rename(backupPath, path).catch(() => undefined);
    }
    throw error;
  }
}

function isEnoent(error: unknown): boolean {
  return errorCode(error) === "ENOENT";
}

function isRetryableFileError(error: unknown): boolean {
  return ["ENOENT", "EPERM", "EACCES", "EEXIST"].includes(errorCode(error));
}

function errorCode(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : "";
}
