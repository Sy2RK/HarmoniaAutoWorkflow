import type {
  ApiListResponse,
  AppSettings,
  AttachmentRecord,
  DashboardSummary,
  ForwardRecord,
  KnowledgeEntry,
  MailMessage,
  ReplyDraft
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

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...init.headers
    }
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }
  return (await response.json()) as T;
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
  drafts: () => request<ApiListResponse<ReplyDraft>>("/drafts"),
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
  runSync: () => request<{ received: number; processed: number }>("/sync/run", { method: "POST" })
};
