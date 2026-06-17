import type {
  ApiListResponse,
  AppSettings,
  AttachmentRecord,
  DashboardSummary,
  DraftStatus,
  ForwardRecord,
  KnowledgeEntry,
  MailMessage,
  ReplyDraft,
  ScholarshipCheckJob,
  ScholarshipCheckRow
} from "@harmonia/shared";

const baseUrl = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

export type AuditRecord = {
  id: string;
  messageId: string | null;
  actor: string;
  action: string;
  detail: Record<string, unknown>;
  createdAt: string;
};

export type MessageDetail = {
  message: MailMessage;
  attachments: AttachmentRecord[];
  draft: ReplyDraft | null;
  audits: AuditRecord[];
};

export type ScholarshipCheckJobDetail = {
  job: ScholarshipCheckJob;
  rows: ScholarshipCheckRow[];
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    credentials: "include",
    headers
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

async function uploadRequest<T>(path: string, formData: FormData): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    credentials: "include",
    body: formData
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

async function downloadRequest(path: string): Promise<Blob> {
  const response = await fetch(`${baseUrl}${path}`, {
    credentials: "include"
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }
  return response.blob();
}

export const api = {
  login: (email: string, password: string) =>
    request<{ user: { id: string; email: string; role: string } }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    }),
  logout: () => request<{ ok: true }>("/auth/logout", { method: "POST" }),
  me: () => request<{ user: { id: string; email: string; role: string } | null }>("/auth/me"),
  dashboard: () => request<DashboardSummary>("/dashboard"),
  messages: (query = "") => request<ApiListResponse<MailMessage>>(`/messages${query}`),
  messageDetail: (id: string) => request<MessageDetail>(`/messages/${id}`),
  processMessage: (id: string) => request<{ message: MailMessage }>(`/messages/${id}/process`, { method: "POST" }),
  drafts: (status?: DraftStatus) => request<ApiListResponse<ReplyDraft>>(`/drafts${status ? `?status=${status}` : ""}`),
  saveDraft: (id: string, body: string) =>
    request<{ draft: ReplyDraft }>(`/drafts/${id}`, { method: "PATCH", body: JSON.stringify({ body }) }),
  sendDraft: (id: string) => request<{ draft: ReplyDraft; message: MailMessage }>(`/drafts/${id}/send`, { method: "POST" }),
  rejectDraft: (id: string) => request<{ draft: ReplyDraft }>(`/drafts/${id}/reject`, { method: "POST" }),
  markManual: (id: string) => request<{ draft: ReplyDraft }>(`/drafts/${id}/manual`, { method: "POST" }),
  noReply: (id: string) => request<{ draft: ReplyDraft }>(`/drafts/${id}/no-reply`, { method: "POST" }),
  forwards: () => request<ApiListResponse<ForwardRecord>>("/forward-records"),
  settings: () => request<AppSettings>("/settings"),
  saveSettings: (settings: AppSettings) => request<AppSettings>("/settings", { method: "PATCH", body: JSON.stringify(settings) }),
  knowledge: () => request<ApiListResponse<KnowledgeEntry>>("/knowledge-base"),
  saveKnowledge: (entry: Pick<KnowledgeEntry, "category" | "question" | "answer" | "enabled"> & { id?: string }) =>
    request<{ entry: KnowledgeEntry }>("/knowledge-base", { method: "POST", body: JSON.stringify(entry) }),
  runSync: () => request<{ received: number; processed: number }>("/sync/run", { method: "POST" }),
  createScholarshipCheckJob: (workbook: File, evidenceFiles: File[]) => {
    const formData = new FormData();
    formData.append("workbook", workbook);
    evidenceFiles.forEach((file) => {
      formData.append("evidenceFiles", file);
    });
    formData.append("evidencePaths", JSON.stringify(evidenceFiles.map((file) => file.webkitRelativePath || file.name)));
    return uploadRequest<{ job: ScholarshipCheckJob }>("/scholarship-check/jobs", formData);
  },
  scholarshipCheckJobs: (limit = 5) => request<ApiListResponse<ScholarshipCheckJob>>(`/scholarship-check/jobs?limit=${limit}`),
  scholarshipCheckJob: (id: string) => request<ScholarshipCheckJobDetail>(`/scholarship-check/jobs/${id}`),
  downloadScholarshipCheckResult: (id: string) => downloadRequest(`/scholarship-check/jobs/${id}/result`),
  updateScholarshipCheckRow: (jobId: string, rowNumber: number, remark: string) =>
    request<{ row: ScholarshipCheckRow; job: ScholarshipCheckJob }>(`/scholarship-check/jobs/${jobId}/rows/${rowNumber}`, {
      method: "PATCH",
      body: JSON.stringify({ remark })
    }),
  deleteScholarshipCheckJob: (id: string) => request<{ ok: true }>(`/scholarship-check/jobs/${id}`, { method: "DELETE" }),
  pauseScholarshipCheckJob: (id: string) => request<ScholarshipCheckJobDetail>(`/scholarship-check/jobs/${id}/pause`, { method: "POST" }),
  resumeScholarshipCheckJob: (id: string) => request<ScholarshipCheckJobDetail>(`/scholarship-check/jobs/${id}/resume`, { method: "POST" }),
  cancelScholarshipCheckJob: (id: string) => request<ScholarshipCheckJobDetail>(`/scholarship-check/jobs/${id}/cancel`, { method: "POST" })
};
