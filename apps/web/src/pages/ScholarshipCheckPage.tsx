import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChangeEvent, InputHTMLAttributes } from "react";
import { Download, FileSpreadsheet, FolderOpen, Pause, Pencil, Play, RefreshCw, Save, Square, Trash2, X } from "lucide-react";
import { useLocation } from "react-router-dom";
import type { ScholarshipCheckJob, ScholarshipCheckJobStatus, ScholarshipCheckRow } from "@harmonia/shared";
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

const lastSelectedJobKey = "harmonia.scholarshipCheck.lastSelectedJobId";
const pollingJobStatuses = new Set<ScholarshipCheckJobStatus>(["queued", "processing"]);
const recoveryJobStatuses = new Set<ScholarshipCheckJobStatus>(["queued", "processing", "paused"]);
const downloadableJobStatuses = new Set<ScholarshipCheckJobStatus>(["completed", "cancelled", "failed"]);

const jobStatusLabels: Record<ScholarshipCheckJobStatus, string> = {
  queued: "排队中",
  processing: "核对中",
  paused: "已暂停",
  completed: "已完成",
  failed: "失败",
  cancelled: "已终止"
};

const rowStatusLabels: Record<ScholarshipCheckRow["status"], string> = {
  pending: "待处理",
  processing: "核对中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已终止"
};

const defaultRemarkTemplate = "书院贡献：\n学生组织：\n社会服务与实践：\n奖项：";

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

function currentJobOperation(job: ScholarshipCheckJob, rows: ScholarshipCheckRow[]): string {
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

function hasFourRemarkLines(value: string): boolean {
  return value.replace(/\r\n/g, "\n").trimEnd().split("\n").length === 4;
}

function useFolderUploadSupport(): boolean {
  return useMemo(() => "webkitdirectory" in document.createElement("input"), []);
}

export function ScholarshipCheckPage() {
  const location = useLocation();
  const isVisible = location.pathname === "/scholarship-check";
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
  const [draftRemark, setDraftRemark] = useState("");
  const [savingRowNumber, setSavingRowNumber] = useState<number | null>(null);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");

  const folderUploadSupported = useFolderUploadSupport();
  const evidenceSummary = useMemo(() => summarizeEvidenceFolders(evidenceFiles), [evidenceFiles]);
  const canStart = Boolean(workbook && evidenceFiles.length && !creating);
  const progressTotal = job?.totalApplicants ?? 0;
  const progressValue = job?.processedApplicants ?? 0;
  const progressPercent = job?.status === "completed" ? 100 : progressTotal ? Math.min(100, Math.round((progressValue / progressTotal) * 100)) : 0;
  const progressText = progressTotal ? `${progressPercent}%` : pollingJobStatuses.has(job?.status ?? "failed") ? "准备中" : `${progressPercent}%`;
  const progressKnown = progressTotal > 0;
  const operationText = job ? currentJobOperation(job, rows) : "";
  const canDownload = Boolean(job && downloadableJobStatuses.has(job.status));

  const rememberSelectedJob = useCallback((jobId: string) => {
    window.localStorage.setItem(lastSelectedJobKey, jobId);
  }, []);

  const mergeRecentJob = useCallback((nextJob: ScholarshipCheckJob) => {
    setRecentJobs((previous) => {
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
          const newestActive = result.items.find((item) => recoveryJobStatuses.has(item.status));
          const rememberedId = window.localStorage.getItem(lastSelectedJobKey);
          const remembered = rememberedId ? result.items.find((item) => item.id === rememberedId) : null;
          const selected = newestActive ?? remembered ?? result.items[0] ?? null;
          if (selected) {
            await loadJob(selected.id, { remember: true });
          }
        }
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setRecentLoading(false);
      }
    },
    [loadJob]
  );

  useEffect(() => {
    if (!isVisible) return;
    void loadRecentJobs({ recoverSelection: true });
  }, [isVisible, loadRecentJobs]);

  useEffect(() => {
    if (!job || !pollingJobStatuses.has(job.status)) return;
    const timer = window.setInterval(() => {
      void loadJob(job.id, { remember: true }).catch((err) => {
        setError(errorMessage(err));
      });
    }, 3000);
    return () => window.clearInterval(timer);
  }, [job, loadJob]);

  const selectWorkbook = (event: ChangeEvent<HTMLInputElement>) => {
    setWorkbook(event.currentTarget.files?.[0] ?? null);
  };

  const selectEvidenceFolder = (event: ChangeEvent<HTMLInputElement>) => {
    setEvidenceFiles(Array.from(event.currentTarget.files ?? []));
  };

  const refreshAll = async () => {
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

  const downloadResult = async () => {
    if (!job || !canDownload) return;
    setDownloading(true);
    setError("");
    try {
      const blob = await api.downloadScholarshipCheckResult(job.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "申请人信息处理版-核对结果.xlsx";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setDownloading(false);
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
    setDraftRemark(row.remark ?? defaultRemarkTemplate);
    setFeedback("");
    setError("");
  };

  const saveRemark = async (row: ScholarshipCheckRow) => {
    if (!job) return;
    if (!hasFourRemarkLines(draftRemark)) {
      setError("备注需要保持四行：书院贡献、学生组织、社会服务与实践、奖项。");
      return;
    }
    setSavingRowNumber(row.rowNumber);
    setError("");
    setFeedback("");
    try {
      const result = await api.updateScholarshipCheckRow(job.id, row.rowNumber, draftRemark);
      setJob(result.job);
      setRows((previous) => previous.map((item) => (item.rowNumber === result.row.rowNumber ? result.row : item)));
      mergeRecentJob(result.job);
      setEditingRowNumber(null);
      setDraftRemark("");
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

  return (
    <section>
      <PageHeader
        title="优秀毕业生材料核对"
        meta="上传申请表与证明材料，生成核对备注"
        actions={
          <>
            <button className="icon-text" type="button" onClick={refreshAll} disabled={refreshing || recentLoading}>
              <RefreshCw size={17} />
              <span>{refreshing || recentLoading ? "刷新中" : "刷新"}</span>
            </button>
            {job ? (
              <button className="icon-text" type="button" onClick={downloadResult} disabled={!canDownload || downloading}>
                <Download size={17} />
                <span>{downloading ? "下载中" : "下载处理版 Excel"}</span>
              </button>
            ) : null}
          </>
        }
      />

      {!folderUploadSupported ? <div className="notice danger">当前浏览器不支持文件夹选择，此模块需要选择证明材料文件夹。</div> : null}
      {error ? <div className="notice danger">{error}</div> : null}
      {feedback ? <div className="notice">{feedback}</div> : null}

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
          <button className="icon-button small" type="button" onClick={refreshAll} disabled={refreshing || recentLoading} title="刷新最近记录">
            <RefreshCw size={16} />
          </button>
        </div>
        {recentJobs.length ? (
          <div className="recent-jobs">
            {recentJobs.map((item) => (
              <div className={`recent-job ${job?.id === item.id ? "active" : ""}`} key={item.id}>
                <button className="recent-job-main" type="button" onClick={() => void loadJob(item.id, { remember: true })}>
                  <span className={`badge scholarship-job-${item.status}`}>{jobStatusLabels[item.status]}</span>
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
            <span className={`badge scholarship-job-${job.status}`}>{jobStatusLabels[job.status]}</span>
            <span>已处理 {progressValue} / {progressTotal}</span>
            <strong>{progressText}</strong>
            <span>更新时间 {formatTime(job.updatedAt)}</span>
          </div>
          <div
            className={`job-progress ${progressKnown ? "" : "indeterminate"} scholarship-progress-${job.status}`}
            role="progressbar"
            aria-label="优秀毕业生材料核对进度"
            aria-valuemin={0}
            aria-valuemax={progressKnown ? progressTotal : undefined}
            aria-valuenow={progressKnown ? progressValue : undefined}
          >
            <span style={progressKnown ? { width: `${progressPercent}%` } : undefined} />
          </div>
          <div className="job-progress-detail">{operationText}</div>
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
                  <th>错误</th>
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
                        <span className={`badge scholarship-row-${row.status}`}>{rowStatusLabels[row.status]}</span>
                      </td>
                      <td className="remark-cell">
                        {editing ? (
                          <div className="remark-editor">
                            <textarea value={draftRemark} onChange={(event) => setDraftRemark(event.currentTarget.value)} />
                            <div className="button-row">
                              <button className="icon-text" type="button" onClick={() => void saveRemark(row)} disabled={savingRowNumber === row.rowNumber}>
                                <Save size={16} />
                                <span>{savingRowNumber === row.rowNumber ? "保存中" : "保存"}</span>
                              </button>
                              <button className="icon-text" type="button" onClick={() => setEditingRowNumber(null)}>
                                <X size={16} />
                                <span>取消</span>
                              </button>
                            </div>
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
                      <td>{row.error || "-"}</td>
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
    </section>
  );
}
