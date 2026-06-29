import type {
  ApiListResponse,
  AppSettings,
  AttachmentRecord,
  AwardConfidenceJob,
  AwardConfidenceRow,
  CollegeKnowledgeChatMode,
  CollegeKnowledgeChatResponse,
  CollegeKnowledgeDocument,
  DashboardSummary,
  DraftStatus,
  ForwardRecord,
  KnowledgeEntry,
  MailMessage,
  MessageAgentChatResponse,
  MessageAgentDraft,
  MessageAgentFileRole,
  MessageAgentMessage,
  MessageAgentSession,
  MessageAgentSource,
  MessageAgentTemplate,
  MessageAgentUploadProgress,
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

export type AwardConfidenceJobDetail = {
  job: AwardConfidenceJob;
  rows: AwardConfidenceRow[];
};

export type CollegeKnowledgeUploadResponse = {
  documents: CollegeKnowledgeDocument[];
};

export type AskCollegeKnowledgeInput = {
  message: string;
  mode: CollegeKnowledgeChatMode;
  images?: File[];
  sessionId?: string;
};

export type MessageAgentSessionDetail = {
  session: MessageAgentSession;
  messages: MessageAgentMessage[];
  sources: MessageAgentSource[];
  templates: MessageAgentTemplate[];
  latestDraft: MessageAgentDraft | null;
  uploadProgress: MessageAgentUploadProgress | null;
};

export type MessageAgentUploadResponse = {
  session: MessageAgentSession;
  sources: MessageAgentSource[];
  templates: MessageAgentTemplate[];
  warnings: string[];
  uploadProgress: MessageAgentUploadProgress | null;
};

export type ChatMessageAgentInput = {
  sessionId: string;
  message: string;
  images?: File[];
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
  collegeKnowledgeDocuments: () => request<ApiListResponse<CollegeKnowledgeDocument>>("/college-knowledge/documents"),
  uploadCollegeKnowledgeDocuments: (files: File[], relativePaths?: string[]) => {
    const formData = new FormData();
    files.forEach((file) => {
      formData.append("files", file);
    });
    if (relativePaths?.length) {
      formData.append("relativePaths", JSON.stringify(relativePaths));
    }
    return uploadRequest<CollegeKnowledgeUploadResponse>("/college-knowledge/documents/upload", formData);
  },
  reindexCollegeKnowledgeDocument: (documentId: string) =>
    request<{ document: CollegeKnowledgeDocument }>(`/college-knowledge/documents/${documentId}/reindex`, { method: "POST" }),
  deleteCollegeKnowledgeDocument: (documentId: string) =>
    request<{ ok: true }>(`/college-knowledge/documents/${documentId}`, { method: "DELETE" }),
  askCollegeKnowledge: (input: AskCollegeKnowledgeInput) => {
    const formData = new FormData();
    formData.append("message", input.message);
    formData.append("mode", input.mode);
    if (input.sessionId) formData.append("sessionId", input.sessionId);
    input.images?.forEach((image) => {
      formData.append("images", image);
    });
    return uploadRequest<CollegeKnowledgeChatResponse>("/college-knowledge/chat", formData);
  },
  createMessageAgentSession: () => request<{ session: MessageAgentSession }>("/message-agent/sessions", { method: "POST" }),
  messageAgentSession: (sessionId: string) => request<MessageAgentSessionDetail>(`/message-agent/sessions/${sessionId}`),
  uploadMessageAgentFiles: (sessionId: string, files: File[], fileRole: MessageAgentFileRole, relativePaths?: string[]) => {
    const formData = new FormData();
    formData.append("fileRole", fileRole);
    files.forEach((file) => {
      formData.append("files", file);
    });
    if (relativePaths?.length) {
      formData.append("relativePaths", JSON.stringify(relativePaths));
    }
    return uploadRequest<MessageAgentUploadResponse>(`/message-agent/sessions/${sessionId}/files`, formData);
  },
  chatMessageAgent: (input: ChatMessageAgentInput) => {
    const formData = new FormData();
    formData.append("message", input.message);
    input.images?.forEach((image) => {
      formData.append("images", image);
    });
    return uploadRequest<MessageAgentChatResponse>(`/message-agent/sessions/${input.sessionId}/chat`, formData);
  },
  updateMessageAgentDraft: (sessionId: string, subject: string, body: string) =>
    request<{ draft: MessageAgentDraft }>(`/message-agent/sessions/${sessionId}/draft`, {
      method: "PATCH",
      body: JSON.stringify({ subject, body })
    }),
  downloadMessageAgentDraftDocx: (sessionId: string) => downloadRequest(`/message-agent/sessions/${sessionId}/draft.docx`),
  clearMessageAgentChat: (sessionId: string) => request<MessageAgentSessionDetail>(`/message-agent/sessions/${sessionId}/messages`, { method: "DELETE" }),
  deleteMessageAgentSession: (sessionId: string) => request<{ ok: true }>(`/message-agent/sessions/${sessionId}`, { method: "DELETE" }),
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
  updateScholarshipCheckRow: (jobId: string, rowNumber: number, remark: string, detail: string) =>
    request<{ row: ScholarshipCheckRow; job: ScholarshipCheckJob }>(`/scholarship-check/jobs/${jobId}/rows/${rowNumber}`, {
      method: "PATCH",
      body: JSON.stringify({ remark, detail })
    }),
  deleteScholarshipCheckJob: (id: string) => request<{ ok: true }>(`/scholarship-check/jobs/${id}`, { method: "DELETE" }),
  pauseScholarshipCheckJob: (id: string) => request<ScholarshipCheckJobDetail>(`/scholarship-check/jobs/${id}/pause`, { method: "POST" }),
  resumeScholarshipCheckJob: (id: string) => request<ScholarshipCheckJobDetail>(`/scholarship-check/jobs/${id}/resume`, { method: "POST" }),
  cancelScholarshipCheckJob: (id: string) => request<ScholarshipCheckJobDetail>(`/scholarship-check/jobs/${id}/cancel`, { method: "POST" }),
  createAwardConfidenceJob: (workbook: File) => {
    const formData = new FormData();
    formData.append("workbook", workbook);
    return uploadRequest<{ job: AwardConfidenceJob }>("/award-confidence/jobs", formData);
  },
  awardConfidenceJobs: (limit = 5) => request<ApiListResponse<AwardConfidenceJob>>(`/award-confidence/jobs?limit=${limit}`),
  awardConfidenceJob: (id: string) => request<AwardConfidenceJobDetail>(`/award-confidence/jobs/${id}`),
  deleteAwardConfidenceJob: (id: string) => request<{ ok: true }>(`/award-confidence/jobs/${id}`, { method: "DELETE" }),
  pauseAwardConfidenceJob: (id: string) => request<AwardConfidenceJobDetail>(`/award-confidence/jobs/${id}/pause`, { method: "POST" }),
  resumeAwardConfidenceJob: (id: string) => request<AwardConfidenceJobDetail>(`/award-confidence/jobs/${id}/resume`, { method: "POST" }),
  cancelAwardConfidenceJob: (id: string) => request<AwardConfidenceJobDetail>(`/award-confidence/jobs/${id}/cancel`, { method: "POST" }),
  downloadAwardConfidenceResult: (id: string) => downloadRequest(`/award-confidence/jobs/${id}/result`)
};
