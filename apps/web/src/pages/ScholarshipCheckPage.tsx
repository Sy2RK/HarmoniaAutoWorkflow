import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChangeEvent, InputHTMLAttributes } from "react";
import {
  CircleHelp,
  Download,
  FileSpreadsheet,
  FolderOpen,
  Pause,
  Pencil,
  Play,
  RefreshCw,
  Save,
  Square,
  Trash2,
  Trophy,
  X
} from "lucide-react";
import { useLocation } from "react-router-dom";
import type {
  AwardConfidenceJob,
  AwardConfidenceJobStatus,
  AwardConfidenceRow,
  ScholarshipCheckJob,
  ScholarshipCheckJobStatus,
  ScholarshipCheckRow
} from "@harmonia/shared";
import { api } from "../api/client.js";
import { PageHeader } from "../components/PageHeader.js";

type DirectoryInputProps = InputHTMLAttributes<HTMLInputElement> & {
  webkitdirectory?: string;
  directory?: string;
};

type EvidenceFolderSummary = {
  folder: string;
  count: number;
};

type WorkflowTab = "materials" | "confidence";

const lastSelectedJobKey = "harmonia.scholarshipCheck.lastSelectedJobId";
const lastSelectedAwardJobKey = "harmonia.awardConfidence.lastSelectedJobId";
const materialPollingStatuses = new Set<ScholarshipCheckJobStatus>(["queued", "processing"]);
const materialRecoveryStatuses = new Set<ScholarshipCheckJobStatus>(["queued", "processing", "paused"]);
const materialDownloadableStatuses = new Set<ScholarshipCheckJobStatus>(["completed", "cancelled", "failed"]);
const awardPollingStatuses = new Set<AwardConfidenceJobStatus>(["queued", "processing"]);
const awardRecoveryStatuses = new Set<AwardConfidenceJobStatus>(["queued", "processing", "paused"]);
const awardDownloadableStatuses = new Set<AwardConfidenceJobStatus>(["completed", "cancelled"]);

const materialJobStatusLabels: Record<ScholarshipCheckJobStatus, string> = {
  queued: "排队中",
  processing: "核对中",
  paused: "已暂停",
  completed: "已完成",
  failed: "失败",
  cancelled: "已终止"
};

const materialRowStatusLabels: Record<ScholarshipCheckRow["status"], string> = {
  pending: "待处理",
  processing: "核对中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已终止"
};

const awardJobStatusLabels: Record<AwardConfidenceJobStatus, string> = {
  queued: "排队中",
  processing: "计算中",
  paused: "已暂停",
  completed: "已完成",
  failed: "失败",
  cancelled: "已终止"
};

const awardRowStatusLabels: Record<AwardConfidenceRow["status"], string> = {
  pending: "待处理",
  processing: "计算中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已终止"
};

const materialCheckLabels = ["书院贡献", "学生组织", "社会服务与实践", "奖项"] as const;
const materialRemarkOptions = ["未填写", "无证明材料", "部分材料缺失", "部分材料不匹配", "无问题"] as const;
type MaterialCheckLabel = (typeof materialCheckLabels)[number];
type MaterialRemarkOption = (typeof materialRemarkOptions)[number];
type MaterialCheckDraft = Record<MaterialCheckLabel, { remark: MaterialRemarkOption; detail: string }>;

const awardFormulaWeights = [
  ["院长嘉许奖", "0.15", "0.30", "0.20", "0.15", "0.20", "0", "0"],
  ["杰出领导力奖", "0.10", "0.20", "0.10", "0.10", "0.50", "0", "0"],
  ["优秀服务奖", "0.10", "0.20", "0.40", "0.25", "0.05", "0", "0"],
  ["卓越体育贡献奖", "0.10", "0.20", "0.05", "0.05", "0.10", "0.50", "0"],
  ["卓越才艺贡献奖", "0.10", "0.20", "0.05", "0.05", "0.10", "0", "0.50"]
] as const;

function evidencePath(file: File): string {
  return file.webkitRelativePath || file.name;
}

function applicantFolderName(file: File): string {
  const parts = evidencePath(file).split(/[\\/]/).filter(Boolean);
  if (parts.length >= 3) return parts[1] ?? "未分组";
  if (parts.length >= 2) return parts[0] ?? "未分组";
  return "未分组";
}

function summarizeEvidenceFolders(files: File[]): EvidenceFolderSummary[] {
  const counts = new Map<string, number>();
  files.forEach((file) => {
    const folder = applicantFolderName(file);
    counts.set(folder, (counts.get(folder) ?? 0) + 1);
  });
  return Array.from(counts, ([folder, count]) => ({ folder, count })).sort((a, b) => a.folder.localeCompare(b.folder));
}

function isXlsxFile(file: File): boolean {
  return file.name.toLowerCase().endsWith(".xlsx");
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString();
}

function shortId(value: string): string {
  return value.slice(0, 8);
}

function shortError(value: string | null): string {
  if (!value) return "";
  return value.length > 72 ? `${value.slice(0, 72)}...` : value;
}

function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  try {
    const parsed = JSON.parse(raw) as { error?: string; message?: string };
    return parsed.error || parsed.message || raw;
  } catch {
    return raw;
  }
}

function currentMaterialOperation(job: ScholarshipCheckJob, rows: ScholarshipCheckRow[]): string {
  if (job.status === "queued") return "正在排队，等待后端开始读取申请表和证明材料。";
  if (job.status === "paused") return "任务已暂停，可继续处理下一位未完成申请人。";
  if (job.status === "completed") return "核对完成，处理版 Excel 已可下载。";
  if (job.status === "cancelled") return "任务已终止，已保留当前可用记录。";
  if (job.status === "failed") return "任务失败，请查看错误信息后决定重试或手动编辑。";

  const currentRow = rows.find((row) => row.status === "processing");
  if (currentRow) {
    const student = currentRow.studentId ? `（${currentRow.studentId}）` : "";
    return `正在核对：${currentRow.name || "未命名申请人"}${student}`;
  }
  if (!job.totalApplicants) return "正在读取申请人信息并整理证明材料。";
  if (job.processedApplicants >= job.totalApplicants) return "正在生成处理版 Excel。";
  return "正在生成下一位申请人的核对备注。";
}

function currentAwardOperation(job: AwardConfidenceJob, rows: AwardConfidenceRow[]): string {
  if (job.status === "queued") return "正在排队，等待后端读取工作簿。";
  if (job.status === "paused") return "任务已暂停，可继续计算下一行未完成记录。";
  if (job.status === "completed") return "置信度计算完成，结果 Excel 已可下载。";
  if (job.status === "cancelled") return "任务已终止，已保留当前可用结果。";
  if (job.status === "failed") return "计算失败，请查看错误信息后重试。";
  const currentRow = rows.find((row) => row.status === "processing");
  if (currentRow) return `正在计算：${currentRow.name || "未命名申请人"}（${currentRow.sheetName}）`;
  if (!job.totalRows) return "正在解析工作簿。";
  if (job.processedRows >= job.totalRows) return "正在生成结果 Excel。";
  return "正在计算下一行奖项置信度。";
}

function createDefaultCheckDraft(): MaterialCheckDraft {
  return Object.fromEntries(materialCheckLabels.map((label) => [label, { remark: "未填写", detail: "" }])) as MaterialCheckDraft;
}

function parseLabeledLines(value: string | null | undefined): Partial<Record<MaterialCheckLabel, string>> {
  const parsed: Partial<Record<MaterialCheckLabel, string>> = {};
  for (const line of (value ?? "").replace(/\r\n/g, "\n").split("\n")) {
    for (const label of materialCheckLabels) {
      if (line.startsWith(`${label}：`)) parsed[label] = line.slice(label.length + 1).trim();
      if (line.startsWith(`${label}:`)) parsed[label] = line.slice(label.length + 1).trim();
    }
  }
  return parsed;
}

function normalizeRemarkOption(value: string | undefined): MaterialRemarkOption {
  if (value && (materialRemarkOptions as readonly string[]).includes(value)) return value as MaterialRemarkOption;
  if (value?.includes("不匹配") || value?.includes("不一致") || value?.includes("不符")) return "部分材料不匹配";
  if (value?.includes("部分") || value?.includes("缺失") || value?.includes("无法渲染") || value?.includes("人工复核")) return "部分材料缺失";
  if (value?.includes("无证明")) return "无证明材料";
  if (value?.includes("无问题")) return "无问题";
  return "未填写";
}

function draftFromRow(row: ScholarshipCheckRow): MaterialCheckDraft {
  const remarkLines = parseLabeledLines(row.remark);
  const detailLines = parseLabeledLines(row.detail);
  return Object.fromEntries(
    materialCheckLabels.map((label) => [
      label,
      {
        remark: normalizeRemarkOption(remarkLines[label]),
        detail: detailLines[label] || "旧记录未提供详细情况，可补充原因。"
      }
    ])
  ) as MaterialCheckDraft;
}

function formatDraftRemark(draft: MaterialCheckDraft): string {
  return materialCheckLabels.map((label) => `${label}：${draft[label].remark}`).join("\n");
}

function formatDraftDetail(draft: MaterialCheckDraft): string {
  return materialCheckLabels.map((label) => `${label}：${draft[label].detail.trim() || "未填写详细原因。"}`).join("\n");
}

function formatConfidence(value: number | null): string {
  return value === null ? "-" : value.toFixed(1);
}

function confidenceClass(value: number | null): string {
  if (value === null) return "confidence-empty";
  if (value >= 85) return "confidence-high";
  if (value >= 70) return "confidence-medium-high";
  if (value >= 50) return "confidence-uncertain";
  return "confidence-low";
}

function useFolderUploadSupport(): boolean {
  return useMemo(() => "webkitdirectory" in document.createElement("input"), []);
}

export function ScholarshipCheckPage() {
  const location = useLocation();
  const isVisible = location.pathname === "/scholarship-check";
  const [activeTab, setActiveTab] = useState<WorkflowTab>("materials");

  const [workbook, setWorkbook] = useState<File | null>(null);
  const [evidenceFiles, setEvidenceFiles] = useState<File[]>([]);
  const [recentJobs, setRecentJobs] = useState<ScholarshipCheckJob[]>([]);
  const [job, setJob] = useState<ScholarshipCheckJob | null>(null);
  const [rows, setRows] = useState<ScholarshipCheckRow[]>([]);
  const [creating, setCreating] = useState(false);
  const [recentLoading, setRecentLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [actioning, setActioning] = useState<"pause" | "resume" | "cancel" | "delete" | null>(null);
  const [editingRowNumber, setEditingRowNumber] = useState<number | null>(null);
  const [draftCheck, setDraftCheck] = useState<MaterialCheckDraft>(() => createDefaultCheckDraft());
  const [savingRowNumber, setSavingRowNumber] = useState<number | null>(null);

  const [awardWorkbook, setAwardWorkbook] = useState<File | null>(null);
  const [awardRecentJobs, setAwardRecentJobs] = useState<AwardConfidenceJob[]>([]);
  const [awardJob, setAwardJob] = useState<AwardConfidenceJob | null>(null);
  const [awardRows, setAwardRows] = useState<AwardConfidenceRow[]>([]);
  const [awardCreating, setAwardCreating] = useState(false);
  const [awardRecentLoading, setAwardRecentLoading] = useState(false);
  const [awardRefreshing, setAwardRefreshing] = useState(false);
  const [awardDownloading, setAwardDownloading] = useState(false);
  const [awardActioning, setAwardActioning] = useState<"pause" | "resume" | "cancel" | "delete" | null>(null);
  const [showAwardFormulaHelp, setShowAwardFormulaHelp] = useState(false);

  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");

  const folderUploadSupported = useFolderUploadSupport();
  const evidenceSummary = useMemo(() => summarizeEvidenceFolders(evidenceFiles), [evidenceFiles]);
  const canStart = Boolean(workbook && evidenceFiles.length && !creating);
  const materialProgressTotal = job?.totalApplicants ?? 0;
  const materialProgressValue = job?.processedApplicants ?? 0;
  const materialProgressPercent =
    job?.status === "completed" ? 100 : materialProgressTotal ? Math.min(100, Math.round((materialProgressValue / materialProgressTotal) * 100)) : 0;
  const materialProgressText = materialProgressTotal
    ? `${materialProgressPercent}%`
    : materialPollingStatuses.has(job?.status ?? "failed")
      ? "准备中"
      : `${materialProgressPercent}%`;
  const materialProgressKnown = materialProgressTotal > 0;
  const materialOperationText = job ? currentMaterialOperation(job, rows) : "";
  const canDownloadMaterial = Boolean(job && materialDownloadableStatuses.has(job.status));

  const awardProgressTotal = awardJob?.totalRows ?? 0;
  const awardProgressValue = awardJob?.processedRows ?? 0;
  const awardProgressPercent =
    awardJob?.status === "completed" ? 100 : awardProgressTotal ? Math.min(100, Math.round((awardProgressValue / awardProgressTotal) * 100)) : 0;
  const awardProgressText = awardProgressTotal
    ? `${awardProgressPercent}%`
    : awardPollingStatuses.has(awardJob?.status ?? "failed")
      ? "准备中"
      : `${awardProgressPercent}%`;
  const awardProgressKnown = awardProgressTotal > 0;
  const awardOperationText = awardJob ? currentAwardOperation(awardJob, awardRows) : "";
  const canDownloadAward = Boolean(awardJob && awardDownloadableStatuses.has(awardJob.status));

  const rememberSelectedJob = useCallback((jobId: string) => {
    window.localStorage.setItem(lastSelectedJobKey, jobId);
  }, []);

  const rememberSelectedAwardJob = useCallback((jobId: string) => {
    window.localStorage.setItem(lastSelectedAwardJobKey, jobId);
  }, []);

  const mergeRecentJob = useCallback((nextJob: ScholarshipCheckJob) => {
    setRecentJobs((previous) => {
      const merged = [nextJob, ...previous.filter((item) => item.id !== nextJob.id)];
      return merged.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 5);
    });
  }, []);

  const mergeAwardRecentJob = useCallback((nextJob: AwardConfidenceJob) => {
    setAwardRecentJobs((previous) => {
      const merged = [nextJob, ...previous.filter((item) => item.id !== nextJob.id)];
      return merged.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 5);
    });
  }, []);

  const loadJob = useCallback(
    async (jobId: string, options: { remember?: boolean } = {}) => {
      const detail = await api.scholarshipCheckJob(jobId);
      setJob(detail.job);
      setRows(detail.rows);
      mergeRecentJob(detail.job);
      if (options.remember !== false) rememberSelectedJob(detail.job.id);
      return detail;
    },
    [mergeRecentJob, rememberSelectedJob]
  );

  const loadRecentJobs = useCallback(
    async (options: { recoverSelection?: boolean } = {}) => {
      setRecentLoading(true);
      try {
        const result = await api.scholarshipCheckJobs(5);
        setRecentJobs(result.items);
        if (options.recoverSelection) {
          const newestActive = result.items.find((item) => materialRecoveryStatuses.has(item.status));
          const rememberedId = window.localStorage.getItem(lastSelectedJobKey);
          const remembered = rememberedId ? result.items.find((item) => item.id === rememberedId) : null;
          const selected = newestActive ?? remembered ?? result.items[0] ?? null;
          if (selected) await loadJob(selected.id, { remember: true });
        }
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setRecentLoading(false);
      }
    },
    [loadJob]
  );

  const loadAwardJob = useCallback(
    async (jobId: string, options: { remember?: boolean } = {}) => {
      const detail = await api.awardConfidenceJob(jobId);
      setAwardJob(detail.job);
      setAwardRows(detail.rows);
      mergeAwardRecentJob(detail.job);
      if (options.remember !== false) rememberSelectedAwardJob(detail.job.id);
      return detail;
    },
    [mergeAwardRecentJob, rememberSelectedAwardJob]
  );

  const loadAwardRecentJobs = useCallback(
    async (options: { recoverSelection?: boolean } = {}) => {
      setAwardRecentLoading(true);
      try {
        const result = await api.awardConfidenceJobs(5);
        setAwardRecentJobs(result.items);
        if (options.recoverSelection) {
          const newestActive = result.items.find((item) => awardRecoveryStatuses.has(item.status));
          const rememberedId = window.localStorage.getItem(lastSelectedAwardJobKey);
          const remembered = rememberedId ? result.items.find((item) => item.id === rememberedId) : null;
          const selected = newestActive ?? remembered ?? result.items[0] ?? null;
          if (selected) await loadAwardJob(selected.id, { remember: true });
        }
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setAwardRecentLoading(false);
      }
    },
    [loadAwardJob]
  );

  useEffect(() => {
    if (!isVisible) return;
    void loadRecentJobs({ recoverSelection: true });
    void loadAwardRecentJobs({ recoverSelection: true });
  }, [isVisible, loadAwardRecentJobs, loadRecentJobs]);

  useEffect(() => {
    if (!job || !materialPollingStatuses.has(job.status)) return;
    const timer = window.setInterval(() => {
      void loadJob(job.id, { remember: true }).catch((err) => {
        setError(errorMessage(err));
      });
    }, 3000);
    return () => window.clearInterval(timer);
  }, [job, loadJob]);

  useEffect(() => {
    if (!awardJob || !awardPollingStatuses.has(awardJob.status)) return;
    const timer = window.setInterval(() => {
      void loadAwardJob(awardJob.id).catch((err) => {
        setError(errorMessage(err));
      });
    }, 3000);
    return () => window.clearInterval(timer);
  }, [awardJob, loadAwardJob]);

  const switchTab = (nextTab: WorkflowTab) => {
    setActiveTab(nextTab);
    setError("");
    setFeedback("");
    if (nextTab !== "confidence") setShowAwardFormulaHelp(false);
  };

  const selectWorkbook = (event: ChangeEvent<HTMLInputElement>) => {
    setWorkbook(event.currentTarget.files?.[0] ?? null);
  };

  const selectEvidenceFolder = (event: ChangeEvent<HTMLInputElement>) => {
    setEvidenceFiles(Array.from(event.currentTarget.files ?? []));
  };

  const selectAwardWorkbook = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0] ?? null;
    setAwardWorkbook(file);
    setError(file && !isXlsxFile(file) ? "请选择 .xlsx 工作簿。" : "");
  };

  const refreshMaterial = async () => {
    setRefreshing(true);
    setError("");
    try {
      await loadRecentJobs({ recoverSelection: false });
      if (job) await loadJob(job.id, { remember: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setRefreshing(false);
    }
  };

  const refreshAward = async () => {
    setAwardRefreshing(true);
    setError("");
    try {
      await loadAwardRecentJobs({ recoverSelection: false });
      if (awardJob) await loadAwardJob(awardJob.id, { remember: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setAwardRefreshing(false);
    }
  };

  const refreshCurrent = () => {
    if (activeTab === "materials") return void refreshMaterial();
    return void refreshAward();
  };

  const startJob = async () => {
    if (!workbook || !evidenceFiles.length) return;
    setCreating(true);
    setError("");
    setFeedback("");
    setJob(null);
    setRows([]);
    try {
      const result = await api.createScholarshipCheckJob(workbook, evidenceFiles);
      rememberSelectedJob(result.job.id);
      mergeRecentJob(result.job);
      await loadJob(result.job.id, { remember: true });
      await loadRecentJobs();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setCreating(false);
    }
  };

  const startAwardJob = async () => {
    if (!awardWorkbook) {
      setError("请选择 .xlsx 工作簿。");
      return;
    }
    if (!isXlsxFile(awardWorkbook)) {
      setError("请选择 .xlsx 工作簿。");
      return;
    }
    setAwardCreating(true);
    setError("");
    setFeedback("");
    setAwardJob(null);
    setAwardRows([]);
    try {
      const result = await api.createAwardConfidenceJob(awardWorkbook);
      rememberSelectedAwardJob(result.job.id);
      mergeAwardRecentJob(result.job);
      await loadAwardJob(result.job.id, { remember: true });
      await loadAwardRecentJobs();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setAwardCreating(false);
    }
  };

  const downloadMaterialResult = async () => {
    if (!job || !canDownloadMaterial) return;
    setDownloading(true);
    setError("");
    try {
      const blob = await api.downloadScholarshipCheckResult(job.id);
      downloadBlob(blob, "申请人信息处理版-核对结果.xlsx");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setDownloading(false);
    }
  };

  const downloadAwardResult = async () => {
    if (!awardJob || !canDownloadAward) return;
    setAwardDownloading(true);
    setError("");
    try {
      const blob = await api.downloadAwardConfidenceResult(awardJob.id);
      downloadBlob(blob, "奖项置信度结果.xlsx");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setAwardDownloading(false);
    }
  };

  const runAwardLifecycleAction = async (action: "pause" | "resume" | "cancel") => {
    if (!awardJob) return;
    if (action === "cancel" && !window.confirm("终止任务后，已发生的模型调用可能已经计费。确认终止？")) return;
    setAwardActioning(action);
    setError("");
    setFeedback("");
    try {
      const detail =
        action === "pause"
          ? await api.pauseAwardConfidenceJob(awardJob.id)
          : action === "resume"
            ? await api.resumeAwardConfidenceJob(awardJob.id)
            : await api.cancelAwardConfidenceJob(awardJob.id);
      setAwardJob(detail.job);
      setAwardRows(detail.rows);
      mergeAwardRecentJob(detail.job);
      setFeedback(action === "pause" ? "奖项置信度任务已暂停" : action === "resume" ? "奖项置信度任务已继续" : "奖项置信度任务已终止");
      await loadAwardRecentJobs();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setAwardActioning(null);
    }
  };

  const deleteSelectedAwardJob = async (jobId: string) => {
    const target = awardRecentJobs.find((item) => item.id === jobId) ?? awardJob;
    const label = target ? `${formatTime(target.createdAt)} 的记录` : "这条记录";
    if (!window.confirm(`确认删除${label}？删除后将无法从前端恢复该记录。`)) return;
    setAwardActioning("delete");
    setError("");
    setFeedback("");
    try {
      await api.deleteAwardConfidenceJob(jobId);
      setAwardRecentJobs((previous) => previous.filter((item) => item.id !== jobId));
      if (awardJob?.id === jobId) {
        setAwardJob(null);
        setAwardRows([]);
        window.localStorage.removeItem(lastSelectedAwardJobKey);
      }
      setFeedback("奖项置信度记录已删除");
      await loadAwardRecentJobs({ recoverSelection: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setAwardActioning(null);
    }
  };

  const runLifecycleAction = async (action: "pause" | "resume" | "cancel") => {
    if (!job) return;
    if (action === "cancel" && !window.confirm("终止任务后，已发生的模型调用可能已经计费。确认终止？")) return;
    setActioning(action);
    setError("");
    setFeedback("");
    try {
      const detail =
        action === "pause"
          ? await api.pauseScholarshipCheckJob(job.id)
          : action === "resume"
            ? await api.resumeScholarshipCheckJob(job.id)
            : await api.cancelScholarshipCheckJob(job.id);
      setJob(detail.job);
      setRows(detail.rows);
      mergeRecentJob(detail.job);
      setFeedback(action === "pause" ? "任务已暂停" : action === "resume" ? "任务已继续" : "任务已终止");
      await loadRecentJobs();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setActioning(null);
    }
  };

  const deleteSelectedJob = async (jobId: string) => {
    const target = recentJobs.find((item) => item.id === jobId) ?? job;
    const label = target ? `${formatTime(target.createdAt)} 的记录` : "这条记录";
    if (!window.confirm(`确认删除${label}？删除后将无法从前端恢复该记录。`)) return;
    setActioning("delete");
    setError("");
    setFeedback("");
    try {
      await api.deleteScholarshipCheckJob(jobId);
      setRecentJobs((previous) => previous.filter((item) => item.id !== jobId));
      if (job?.id === jobId) {
        setJob(null);
        setRows([]);
        window.localStorage.removeItem(lastSelectedJobKey);
      }
      setFeedback("记录已删除");
      await loadRecentJobs({ recoverSelection: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setActioning(null);
    }
  };

  const beginEdit = (row: ScholarshipCheckRow) => {
    setEditingRowNumber(row.rowNumber);
    setDraftCheck(draftFromRow(row));
    setFeedback("");
    setError("");
  };

  const saveRemark = async (row: ScholarshipCheckRow) => {
    if (!job) return;
    setSavingRowNumber(row.rowNumber);
    setError("");
    setFeedback("");
    try {
      const result = await api.updateScholarshipCheckRow(job.id, row.rowNumber, formatDraftRemark(draftCheck), formatDraftDetail(draftCheck));
      setJob(result.job);
      setRows((previous) => previous.map((item) => (item.rowNumber === result.row.rowNumber ? result.row : item)));
      mergeRecentJob(result.job);
      setEditingRowNumber(null);
      setDraftCheck(createDefaultCheckDraft());
      setFeedback("备注已保存");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSavingRowNumber(null);
    }
  };

  const directoryInputProps = {
    type: "file",
    multiple: true,
    webkitdirectory: "true",
    directory: "",
    onChange: selectEvidenceFolder,
    disabled: !folderUploadSupported || creating
  } satisfies DirectoryInputProps;

  const headerDownload =
    activeTab === "materials" && job ? (
      <button className="icon-text" type="button" onClick={downloadMaterialResult} disabled={!canDownloadMaterial || downloading}>
        <Download size={17} />
        <span>{downloading ? "下载中" : "下载处理版 Excel"}</span>
      </button>
    ) : activeTab === "confidence" && awardJob ? (
      <button className="icon-text" type="button" onClick={downloadAwardResult} disabled={!canDownloadAward || awardDownloading}>
        <Download size={17} />
        <span>{awardDownloading ? "下载中" : "下载置信度 Excel"}</span>
      </button>
    ) : null;

  return (
    <section>
      <PageHeader
        title="优秀毕业生核对"
        meta={activeTab === "materials" ? "上传申请表与证明材料，生成核对备注" : "上传奖项申请资料，生成置信度结果"}
        actions={
          <>
            {activeTab === "confidence" ? (
              <button className="icon-button" type="button" onClick={() => setShowAwardFormulaHelp(true)} title="查看置信度计算公式" aria-label="查看置信度计算公式">
                <CircleHelp size={18} />
              </button>
            ) : null}
            <button
              className="icon-text"
              type="button"
              onClick={refreshCurrent}
              disabled={activeTab === "materials" ? refreshing || recentLoading : awardRefreshing || awardRecentLoading}
            >
              <RefreshCw size={17} />
              <span>{refreshing || recentLoading || awardRefreshing || awardRecentLoading ? "刷新中" : "刷新"}</span>
            </button>
            {headerDownload}
          </>
        }
      />

      <div className="segmented-tabs" role="tablist" aria-label="优秀毕业生核对工作流">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "materials"}
          className={activeTab === "materials" ? "active" : ""}
          onClick={() => switchTab("materials")}
        >
          材料核对
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "confidence"}
          className={activeTab === "confidence" ? "active" : ""}
          onClick={() => switchTab("confidence")}
        >
          奖项置信度
        </button>
      </div>

      {error ? <div className="notice danger">{error}</div> : null}
      {feedback ? <div className="notice">{feedback}</div> : null}

      {showAwardFormulaHelp ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setShowAwardFormulaHelp(false)}>
          <section
            className="formula-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="award-formula-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="panel-heading">
              <div>
                <div className="panel-title" id="award-formula-title">
                  奖项置信度加权公式
                </div>
                <p className="formula-subtitle">只评价与书院生活、社会服务、书院活动和书院组织相关的条目。</p>
              </div>
              <button className="icon-button small" type="button" onClick={() => setShowAwardFormulaHelp(false)} title="关闭说明">
                <X size={16} />
              </button>
            </div>

            <div className="formula-content">
              <div className="formula-box">
                <code>置信度 = round(100 * clamp(Σ(字段分 * 奖项权重) / Σ奖项权重 - 风险扣分, 0, 1), 1)</code>
              </div>
              <p>
                字段分由模型按 0 到 1 评估；风险扣分为 0 到 0.35。若某个奖项单元格为空，对应置信度为空且不调用模型。
                GPA、学业表现、普通外部奖项、纯比赛名次、推荐人完整性和初审情况不计入加分。
              </p>

              <div className="table-wrap">
                <table className="formula-table">
                  <thead>
                    <tr>
                      <th>奖项</th>
                      <th>个人陈述</th>
                      <th>书院贡献</th>
                      <th>社会服务</th>
                      <th>宿舍服务</th>
                      <th>学生组织</th>
                      <th>书院体育</th>
                      <th>书院才艺</th>
                    </tr>
                  </thead>
                  <tbody>
                    {awardFormulaWeights.map((item) => (
                      <tr key={item[0]}>
                        {item.map((value, index) => (
                          <td key={`${item[0]}-${index}`}>{value}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="formula-bands">
                <span>
                  <strong>85-100</strong> 高置信
                </span>
                <span>
                  <strong>70-84.9</strong> 较高
                </span>
                <span>
                  <strong>50-69.9</strong> 存疑
                </span>
                <span>
                  <strong>&lt;50</strong> 较低
                </span>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {activeTab === "materials" ? (
        <>
          {!folderUploadSupported ? <div className="notice danger">当前浏览器不支持文件夹选择，此模块需要选择证明材料文件夹。</div> : null}

          <div className="scholarship-grid">
            <section className="panel">
              <div className="panel-title">上传材料</div>
              <div className="upload-grid">
                <label className="file-field">
                  <span>系统导出原版 Excel</span>
                  <input
                    type="file"
                    accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    onChange={selectWorkbook}
                    disabled={creating}
                  />
                </label>
                <label className="file-field">
                  <span>证明材料文件夹</span>
                  <input {...directoryInputProps} />
                </label>
              </div>
              <div className="selected-files">
                <div>
                  <FileSpreadsheet size={18} />
                  <span>{workbook ? workbook.name : "尚未选择 Excel"}</span>
                </div>
                <div>
                  <FolderOpen size={18} />
                  <span>{evidenceFiles.length ? `${evidenceFiles.length} 个证明文件` : "尚未选择证明材料文件夹"}</span>
                </div>
              </div>
              <div className="button-row">
                <button className="primary-action compact" type="button" onClick={startJob} disabled={!canStart}>
                  {creating ? <RefreshCw size={17} /> : <Play size={17} />}
                  <span>{creating ? "创建任务中" : "开始核对"}</span>
                </button>
                <span className="muted-hint">确认文件无误后开始，核对过程可能调用材料识别模型。</span>
              </div>
            </section>

            <aside className="panel">
              <div className="panel-title">文件夹概览</div>
              {evidenceSummary.length ? (
                <ul className="folder-breakdown">
                  {evidenceSummary.slice(0, 10).map((item) => (
                    <li key={item.folder}>
                      <span>{item.folder}</span>
                      <strong>{item.count}</strong>
                    </li>
                  ))}
                  {evidenceSummary.length > 10 ? <li className="muted-row">还有 {evidenceSummary.length - 10} 个文件夹</li> : null}
                </ul>
              ) : (
                <div className="empty-panel">选择证明材料文件夹后显示申请人文件数</div>
              )}
            </aside>
          </div>

          <section className="panel">
            <div className="panel-heading">
              <div className="panel-title">最近核对记录</div>
              <button className="icon-button small" type="button" onClick={refreshMaterial} disabled={refreshing || recentLoading} title="刷新最近记录">
                <RefreshCw size={16} />
              </button>
            </div>
            {recentJobs.length ? (
              <div className="recent-jobs">
                {recentJobs.map((item) => (
                  <div className={`recent-job ${job?.id === item.id ? "active" : ""}`} key={item.id}>
                    <button className="recent-job-main" type="button" onClick={() => void loadJob(item.id, { remember: true })}>
                      <span className={`badge scholarship-job-${item.status}`}>{materialJobStatusLabels[item.status]}</span>
                      <strong>记录 {shortId(item.id)}</strong>
                      <span>创建 {formatTime(item.createdAt)}</span>
                      <span>更新 {formatTime(item.updatedAt)}</span>
                      <span>已处理 {item.processedApplicants} / {item.totalApplicants}</span>
                      {item.error ? <em>{shortError(item.error)}</em> : null}
                    </button>
                    <button
                      className="icon-button small danger"
                      type="button"
                      onClick={() => void deleteSelectedJob(item.id)}
                      disabled={actioning === "delete"}
                      title="删除记录"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-panel">{recentLoading ? "正在加载最近记录" : "暂无最近核对记录"}</div>
            )}
          </section>

          {job ? (
            <section className="panel">
              <div className="panel-heading">
                <div className="panel-title">当前任务进度</div>
                <div className="button-row">
                  {job.status === "queued" || job.status === "processing" ? (
                    <>
                      <button className="icon-text" type="button" onClick={() => void runLifecycleAction("pause")} disabled={Boolean(actioning)}>
                        <Pause size={17} />
                        <span>{actioning === "pause" ? "暂停中" : "暂停"}</span>
                      </button>
                      <button className="icon-text danger" type="button" onClick={() => void runLifecycleAction("cancel")} disabled={Boolean(actioning)}>
                        <Square size={17} />
                        <span>{actioning === "cancel" ? "终止中" : "终止"}</span>
                      </button>
                    </>
                  ) : null}
                  {job.status === "paused" ? (
                    <>
                      <button className="icon-text" type="button" onClick={() => void runLifecycleAction("resume")} disabled={Boolean(actioning)}>
                        <Play size={17} />
                        <span>{actioning === "resume" ? "继续中" : "继续"}</span>
                      </button>
                      <button className="icon-text danger" type="button" onClick={() => void runLifecycleAction("cancel")} disabled={Boolean(actioning)}>
                        <Square size={17} />
                        <span>{actioning === "cancel" ? "终止中" : "终止"}</span>
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
              <div className="job-summary">
                <span className={`badge scholarship-job-${job.status}`}>{materialJobStatusLabels[job.status]}</span>
                <span>已处理 {materialProgressValue} / {materialProgressTotal}</span>
                <strong>{materialProgressText}</strong>
                <span>更新时间 {formatTime(job.updatedAt)}</span>
              </div>
              <div
                className={`job-progress ${materialProgressKnown ? "" : "indeterminate"} scholarship-progress-${job.status}`}
                role="progressbar"
                aria-label="优秀毕业生材料核对进度"
                aria-valuemin={0}
                aria-valuemax={materialProgressKnown ? materialProgressTotal : undefined}
                aria-valuenow={materialProgressKnown ? materialProgressValue : undefined}
              >
                <span style={materialProgressKnown ? { width: `${materialProgressPercent}%` } : undefined} />
              </div>
              <div className="job-progress-detail">{materialOperationText}</div>
              {job.error ? <div className="notice danger">{job.error}</div> : null}
            </section>
          ) : null}

          {job ? (
            <section className="panel">
              <div className="panel-title">核对预览</div>
              <div className="table-wrap">
                <table className="scholarship-table">
                  <thead>
                    <tr>
                      <th>姓名</th>
                      <th>学号</th>
                      <th>状态</th>
                      <th>核对情况备注</th>
                      <th>详细情况</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const editing = editingRowNumber === row.rowNumber;
                      return (
                        <tr key={`${row.rowNumber}-${row.studentId || row.name}`}>
                          <td>{row.name || "-"}</td>
                          <td>{row.studentId || "-"}</td>
                          <td>
                            <span className={`badge scholarship-row-${row.status}`}>{materialRowStatusLabels[row.status]}</span>
                          </td>
                          <td className="remark-cell">
                            {editing ? (
                              <div className="remark-status-editor">
                                {materialCheckLabels.map((label) => (
                                  <label key={label}>
                                    <span>{label}</span>
                                    <select
                                      value={draftCheck[label].remark}
                                      onChange={(event) =>
                                        setDraftCheck((previous) => ({
                                          ...previous,
                                          [label]: { ...previous[label], remark: event.currentTarget.value as MaterialRemarkOption }
                                        }))
                                      }
                                    >
                                      {materialRemarkOptions.map((option) => (
                                        <option key={option} value={option}>
                                          {option}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                ))}
                              </div>
                            ) : (
                              <div className="remark-display">
                                <pre>{row.remark || "-"}</pre>
                                <button className="icon-button small" type="button" onClick={() => beginEdit(row)} title="编辑备注">
                                  <Pencil size={15} />
                                </button>
                              </div>
                            )}
                          </td>
                          <td className="remark-cell">
                            {editing ? (
                              <div className="detail-editor">
                                {materialCheckLabels.map((label) => (
                                  <label key={label}>
                                    <span>{label}</span>
                                    <textarea
                                      value={draftCheck[label].detail}
                                      onChange={(event) =>
                                        setDraftCheck((previous) => ({
                                          ...previous,
                                          [label]: { ...previous[label], detail: event.currentTarget.value }
                                        }))
                                      }
                                    />
                                  </label>
                                ))}
                                <div className="button-row">
                                  <button
                                    className="icon-text"
                                    type="button"
                                    onClick={() => void saveRemark(row)}
                                    disabled={savingRowNumber === row.rowNumber}
                                  >
                                    <Save size={16} />
                                    <span>{savingRowNumber === row.rowNumber ? "保存中" : "保存"}</span>
                                  </button>
                                  <button
                                    className="icon-text"
                                    type="button"
                                    onClick={() => {
                                      setEditingRowNumber(null);
                                      setDraftCheck(createDefaultCheckDraft());
                                    }}
                                  >
                                    <X size={16} />
                                    <span>取消</span>
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <pre className="detail-display">{row.detail || "-"}</pre>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {!rows.length ? (
                      <tr>
                        <td colSpan={5} className="empty-cell">
                          暂无核对结果
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </>
      ) : (
        <>
          <div className="scholarship-grid">
            <section className="panel">
              <div className="panel-title">上传工作簿</div>
              <div className="upload-grid single">
                <label className="file-field">
                  <span>奖项申请资料 Excel</span>
                  <input
                    type="file"
                    accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    onChange={selectAwardWorkbook}
                    disabled={awardCreating}
                  />
                </label>
              </div>
              <div className="selected-files">
                <div>
                  <FileSpreadsheet size={18} />
                  <span>{awardWorkbook ? awardWorkbook.name : "尚未选择 Excel"}</span>
                </div>
              </div>
              <div className="button-row">
                <button
                  className="primary-action compact"
                  type="button"
                  onClick={startAwardJob}
                  disabled={!awardWorkbook || !isXlsxFile(awardWorkbook) || awardCreating}
                >
                  {awardCreating ? <RefreshCw size={17} /> : <Trophy size={17} />}
                  <span>{awardCreating ? "创建任务中" : "计算置信度"}</span>
                </button>
                <span className="muted-hint">确认文件后开始计算。</span>
              </div>
            </section>

            <aside className="panel">
              <div className="panel-title">工作簿状态</div>
              {awardJob ? (
                <dl className="compact-detail-list">
                  <dt>状态</dt>
                  <dd>
                    <span className={`badge award-job-${awardJob.status}`}>{awardJobStatusLabels[awardJob.status]}</span>
                  </dd>
                  <dt>行数</dt>
                  <dd>
                    {awardJob.processedRows} / {awardJob.totalRows}
                  </dd>
                  <dt>更新</dt>
                  <dd>{formatTime(awardJob.updatedAt)}</dd>
                </dl>
              ) : (
                <div className="empty-panel">选择 Excel 后显示计算状态</div>
              )}
            </aside>
          </div>

          <section className="panel">
            <div className="panel-heading">
              <div className="panel-title">最近置信度记录</div>
              <button className="icon-button small" type="button" onClick={refreshAward} disabled={awardRefreshing || awardRecentLoading} title="刷新最近记录">
                <RefreshCw size={16} />
              </button>
            </div>
            {awardRecentJobs.length ? (
              <div className="recent-jobs">
                {awardRecentJobs.map((item) => (
                  <div className={`recent-job ${awardJob?.id === item.id ? "active" : ""}`} key={item.id}>
                    <button className="recent-job-main" type="button" onClick={() => void loadAwardJob(item.id, { remember: true })}>
                      <span className={`badge award-job-${item.status}`}>{awardJobStatusLabels[item.status]}</span>
                      <strong>记录 {shortId(item.id)}</strong>
                      <span>创建 {formatTime(item.createdAt)}</span>
                      <span>更新 {formatTime(item.updatedAt)}</span>
                      <span>已处理 {item.processedRows} / {item.totalRows}</span>
                      {item.error ? <em>{shortError(item.error)}</em> : null}
                    </button>
                    <button
                      className="icon-button small danger"
                      type="button"
                      onClick={() => void deleteSelectedAwardJob(item.id)}
                      disabled={awardActioning === "delete"}
                      title="删除记录"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-panel">{awardRecentLoading ? "正在加载最近记录" : "暂无最近置信度记录"}</div>
            )}
          </section>

          {awardJob ? (
            <section className="panel">
              <div className="panel-heading">
                <div className="panel-title">置信度进度</div>
                <div className="button-row">
                  {awardJob.status === "queued" || awardJob.status === "processing" ? (
                    <>
                      <button className="icon-text" type="button" onClick={() => void runAwardLifecycleAction("pause")} disabled={Boolean(awardActioning)}>
                        <Pause size={17} />
                        <span>{awardActioning === "pause" ? "暂停中" : "暂停"}</span>
                      </button>
                      <button className="icon-text danger" type="button" onClick={() => void runAwardLifecycleAction("cancel")} disabled={Boolean(awardActioning)}>
                        <Square size={17} />
                        <span>{awardActioning === "cancel" ? "终止中" : "终止"}</span>
                      </button>
                    </>
                  ) : null}
                  {awardJob.status === "paused" ? (
                    <>
                      <button className="icon-text" type="button" onClick={() => void runAwardLifecycleAction("resume")} disabled={Boolean(awardActioning)}>
                        <Play size={17} />
                        <span>{awardActioning === "resume" ? "继续中" : "继续"}</span>
                      </button>
                      <button className="icon-text danger" type="button" onClick={() => void runAwardLifecycleAction("cancel")} disabled={Boolean(awardActioning)}>
                        <Square size={17} />
                        <span>{awardActioning === "cancel" ? "终止中" : "终止"}</span>
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
              <div className="job-summary">
                <span className={`badge award-job-${awardJob.status}`}>{awardJobStatusLabels[awardJob.status]}</span>
                <span>已处理 {awardProgressValue} / {awardProgressTotal}</span>
                <strong>{awardProgressText}</strong>
                <span>更新时间 {formatTime(awardJob.updatedAt)}</span>
              </div>
              <div
                className={`job-progress ${awardProgressKnown ? "" : "indeterminate"} award-progress-${awardJob.status}`}
                role="progressbar"
                aria-label="奖项置信度计算进度"
                aria-valuemin={0}
                aria-valuemax={awardProgressKnown ? awardProgressTotal : undefined}
                aria-valuenow={awardProgressKnown ? awardProgressValue : undefined}
              >
                <span style={awardProgressKnown ? { width: `${awardProgressPercent}%` } : undefined} />
              </div>
              <div className="job-progress-detail">{awardOperationText}</div>
              {awardJob.error ? <div className="notice danger">{awardJob.error}</div> : null}
            </section>
          ) : null}

          {awardJob ? (
            <section className="panel">
              <div className="panel-title">置信度预览</div>
              <div className="table-wrap">
                <table className="award-confidence-table">
                  <thead>
                    <tr>
                      <th>Sheet</th>
                      <th>姓名</th>
                      <th>第一奖项</th>
                      <th>第一奖项置信度</th>
                      <th>第二奖项</th>
                      <th>第二奖项置信度</th>
                      <th>状态</th>
                      <th>错误</th>
                    </tr>
                  </thead>
                  <tbody>
                    {awardRows.map((row) => (
                      <tr key={`${row.sheetName}-${row.rowNumber}-${row.name}`}>
                        <td>{row.sheetName || "-"}</td>
                        <td>{row.name || "-"}</td>
                        <td>{row.firstAward || "-"}</td>
                        <td>
                          <span className={`confidence-score ${confidenceClass(row.firstAwardConfidence)}`}>
                            {formatConfidence(row.firstAwardConfidence)}
                          </span>
                        </td>
                        <td>{row.secondAward || "-"}</td>
                        <td>
                          <span className={`confidence-score ${confidenceClass(row.secondAwardConfidence)}`}>
                            {formatConfidence(row.secondAwardConfidence)}
                          </span>
                        </td>
                        <td>
                          <span className={`badge award-row-${row.status}`}>{awardRowStatusLabels[row.status]}</span>
                        </td>
                        <td>{row.error || "-"}</td>
                      </tr>
                    ))}
                    {!awardRows.length ? (
                      <tr>
                        <td colSpan={8} className="empty-cell">
                          暂无置信度结果
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </>
      )}
    </section>
  );
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
